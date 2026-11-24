import os
import re
import json
import sqlite3
import csv
import io
import threading
import requests
from datetime import datetime, date, timedelta
from functools import lru_cache
from urllib.parse import quote, urljoin
from bs4 import BeautifulSoup
from flask import Flask, render_template, jsonify, request, g

# In-memory CEFR lookup: word (lower) → level string e.g. "B2"
_cefr_map = {}
CEFR_ORDER = {'A1': 0, 'A2': 1, 'B1': 2, 'B2': 3, 'C1': 4, 'C2': 5}

app = Flask(__name__)
DATABASE = os.path.join(os.path.dirname(__file__), 'words.db')
DATA_DIR  = os.path.join(os.path.dirname(__file__), 'data')
_APP_READY = False
_APP_READY_LOCK = threading.Lock()

LEARNING_STEPS_MINUTES = [1, 10]

BUILTIN_DECKS = [
    {'id': 1, 'name': 'SAT Words',        'description': '650 essential SAT vocabulary words',         'file': 'sat_words.json'},
    {'id': 2, 'name': '5000 Most Common', 'description': 'Top 5000 English words by corpus frequency', 'file': 'freq_words.json'},
]

# ─────────────────────────────────────────────────────────────
#  DATABASE
# ─────────────────────────────────────────────────────────────

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA journal_mode = WAL")
    return db

@app.teardown_appcontext
def close_db(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")

    db.executescript("""
        CREATE TABLE IF NOT EXISTS decks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT,
            is_builtin  INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cards (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            word            TEXT NOT NULL,
            phonetic        TEXT,
            audio_url       TEXT,
            deck_id         INTEGER REFERENCES decks(id) ON DELETE SET NULL,
            is_learning     INTEGER NOT NULL DEFAULT 1,
            definition_data TEXT,
            collocations    TEXT,
            register        TEXT,
            notes           TEXT,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS srs_data (
            card_id               INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
            ease_factor           REAL    DEFAULT 2.5,
            interval              INTEGER DEFAULT 0,
            phase                 TEXT    DEFAULT 'new',
            steps_index           INTEGER DEFAULT 0,
            due_datetime          TEXT    DEFAULT (datetime('now')),
            due_date              TEXT    DEFAULT (date('now')),
            last_reviewed         TEXT,
            total_reviews         INTEGER DEFAULT 0,
            correct_reviews       INTEGER DEFAULT 0,
            show_definition_first INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS review_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id         INTEGER REFERENCES cards(id) ON DELETE CASCADE,
            button          TEXT,
            reviewed_at     TEXT DEFAULT (datetime('now')),
            interval_before INTEGER,
            interval_after  INTEGER
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_srs_due_date     ON srs_data(due_date);
        CREATE INDEX IF NOT EXISTS idx_srs_due_datetime ON srs_data(due_datetime);
        CREATE INDEX IF NOT EXISTS idx_cards_deck        ON cards(deck_id);
        CREATE INDEX IF NOT EXISTS idx_review_log_date   ON review_log(reviewed_at);
    """)
    _ensure_schema_migrations(db)

    # Seed builtin decks
    for deck in BUILTIN_DECKS:
        row = db.execute("SELECT id FROM decks WHERE id = ?", [deck['id']]).fetchone()
        if not row:
            db.execute(
                "INSERT INTO decks (id, name, description, is_builtin) VALUES (?,?,?,1)",
                [deck['id'], deck['name'], deck['description']]
            )

    # Seed default settings
    for key, value in [
        ('daily_goal', '20'),
        ('theme', 'dark'),
        ('audio_enabled', 'true'),
        ('cefr_filter_mode', 'all'),
        ('cefr_filter_level', 'B2'),
    ]:
        db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)", [key, value])

    # Create "My Words" user deck if not present
    row = db.execute("SELECT id FROM decks WHERE name = 'My Words' AND is_builtin = 0").fetchone()
    if not row:
        db.execute(
            "INSERT INTO decks (name, description, is_builtin) VALUES "
            "('My Words','Your personal word collection',0)"
        )

    db.commit()
    db.close()

    # Ensure frequency word list is available and comprehensive
    _ensure_freq_words()


def bootstrap_app():
    global _APP_READY
    if _APP_READY:
        return
    with _APP_READY_LOCK:
        if _APP_READY:
            return
        os.makedirs(DATA_DIR, exist_ok=True)
        init_db()
        _migrate_card_hints()
        _load_cefr()
        _APP_READY = True


# ─────────────────────────────────────────────────────────────
#  WORD LIST HELPERS
# ─────────────────────────────────────────────────────────────

@lru_cache(maxsize=4)
def load_word_list(deck_id):
    for deck in BUILTIN_DECKS:
        if deck['id'] == deck_id:
            path = os.path.join(DATA_DIR, deck['file'])
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
    return []


def _column_exists(db, table_name, column_name):
    rows = db.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row['name'] == column_name for row in rows)


def _index_exists(db, index_name):
    row = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
        [index_name]
    ).fetchone()
    return row is not None


def _ensure_schema_migrations(db):
    if not _column_exists(db, 'cards', 'is_learning'):
        db.execute("ALTER TABLE cards ADD COLUMN is_learning INTEGER NOT NULL DEFAULT 1")
    if not _column_exists(db, 'cards', 'audio_url'):
        db.execute("ALTER TABLE cards ADD COLUMN audio_url TEXT")
    db.execute("UPDATE cards SET is_learning=1 WHERE is_learning IS NULL")
    db.execute("CREATE INDEX IF NOT EXISTS idx_cards_learning ON cards(is_learning)")
    if not _index_exists(db, 'idx_cards_deck_word_unique'):
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_deck_word_unique "
            "ON cards(deck_id, lower(word))"
        )


def _cefr_level_for(word):
    return _cefr_map.get((word or '').strip().lower(), '')


def _cefr_matches(level, mode, target):
    if mode in ('', 'all', None):
        return True
    level = (level or '').upper()
    target = (target or '').upper()
    if mode == 'unknown':
        return not level
    if not level or target not in CEFR_ORDER:
        return False
    if mode == 'exact':
        return level == target
    if mode == 'lte':
        return CEFR_ORDER.get(level, 99) <= CEFR_ORDER[target]
    if mode == 'gte':
        return CEFR_ORDER.get(level, -1) >= CEFR_ORDER[target]
    return True


def _stage_for_phase(phase):
    return {
        'new': 'to_learn',
        'learning': 'practiced',
        'review': 'learned',
    }.get((phase or '').strip().lower(), '')


def _stage_matches(phase, requested):
    requested = (requested or '').strip().lower()
    if requested in ('', 'all'):
        return True
    if requested in ('inactive', 'unlearned', 'not_added'):
        return not phase
    if requested in ('new', 'to_learn'):
        return (phase or '').strip().lower() == 'new'
    if requested in ('learning', 'practiced'):
        return (phase or '').strip().lower() == 'learning'
    if requested in ('review', 'learned'):
        return (phase or '').strip().lower() == 'review'
    return _stage_for_phase(phase) == requested


def _srs_reset_values():
    return {
        'ease_factor': 2.5,
        'interval': 0,
        'phase': 'new',
        'steps_index': 0,
        'due_datetime': datetime.now().isoformat(),
        'due_date': date.today().isoformat(),
        'last_reviewed': None,
        'total_reviews': 0,
        'correct_reviews': 0,
        'show_definition_first': 0,
    }


def _reset_card_learning_state(db, card_id):
    vals = _srs_reset_values()
    db.execute("UPDATE cards SET is_learning=1 WHERE id=?", [card_id])
    db.execute(
        """
        UPDATE srs_data
        SET ease_factor=?, interval=?, phase=?, steps_index=?,
            due_datetime=?, due_date=?, last_reviewed=?,
            total_reviews=?, correct_reviews=?, show_definition_first=?
        WHERE card_id=?
        """,
        [
            vals['ease_factor'], vals['interval'], vals['phase'], vals['steps_index'],
            vals['due_datetime'], vals['due_date'], vals['last_reviewed'],
            vals['total_reviews'], vals['correct_reviews'], vals['show_definition_first'],
            card_id,
        ]
    )


def _card_has_prompt(definition_data, notes):
    if isinstance(definition_data, str):
        try:
            definition_data = json.loads(definition_data)
        except Exception:
            definition_data = None
    meanings = (definition_data or {}).get('meanings') if isinstance(definition_data, dict) else []
    if meanings:
        for meaning in meanings:
            for definition in meaning.get('definitions', []):
                if (definition.get('definition') or '').strip():
                    return True
    return bool((notes or '').strip())


def _serialize_card_row(row):
    card = dict(row)
    if card.get('definition_data'):
        try:
            card['definition_data'] = json.loads(card['definition_data'])
        except Exception:
            card['definition_data'] = None
    if card.get('collocations'):
        try:
            card['collocations'] = json.loads(card['collocations'])
        except Exception:
            card['collocations'] = []
    else:
        card['collocations'] = []
    card['cefr_level'] = _cefr_level_for(card.get('word', ''))
    return card


def _ensure_freq_words():
    """Ensure freq_words.json has at least 1 000 properly-ranked words; download if needed."""
    freq_path = os.path.join(DATA_DIR, 'freq_words.json')
    # A proper frequency list starts with super-common function words
    TOP_FREQ = {'the', 'be', 'of', 'and', 'a', 'in', 'to', 'have', 'it', 'that',
                'for', 'on', 'are', 'with', 'as', 'at', 'this', 'from', 'or', 'an'}

    def _looks_good(word_list):
        return len(word_list) >= 1000 and word_list[0]['word'].lower() in TOP_FREQ

    # Check if existing file is already good
    if os.path.exists(freq_path):
        try:
            with open(freq_path, encoding='utf-8') as f:
                existing = json.load(f)
            if _looks_good(existing):
                return  # Already a proper frequency list
            print("[init] Frequency word list looks malformed (not sorted by frequency) — re-parsing")
        except Exception:
            pass

    # Try parsing the PDF first (rank-sorted extraction)
    _parse_frequency_pdf()

    # Check again after PDF parse
    if os.path.exists(freq_path):
        try:
            with open(freq_path, encoding='utf-8') as f:
                existing = json.load(f)
            if _looks_good(existing):
                load_word_list.cache_clear()
                return
        except Exception:
            pass

    # Try downloading Google's 10 000 most common English words (MIT-licensed, free)
    try:
        url = ('https://raw.githubusercontent.com/first20hours/google-10000-english'
               '/master/google-10000-english-usa-no-swears.txt')
        r = requests.get(url, timeout=15)
        if r.status_code == 200:
            seen  = set()
            words = []
            for line in r.text.strip().split('\n'):
                w = line.strip().lower()
                if w and w.isalpha() and len(w) > 1 and w not in seen:
                    seen.add(w)
                    words.append({'word': w, 'pos': '', 'hint': ''})
            if len(words) > 500:
                with open(freq_path, 'w', encoding='utf-8') as f:
                    json.dump(words[:5000], f, ensure_ascii=False, indent=2)
                print(f"[init] Downloaded {len(words)} frequency words")
                load_word_list.cache_clear()
                return
    except Exception as e:
        print(f"[init] Word list download failed: {e}")

    print("[init] Using existing frequency word list")


def _migrate_card_hints():
    """One-time migration: populate notes from word-list hints for cards with no definition and no notes."""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    updated = 0
    for deck_config in BUILTIN_DECKS:
        word_list = load_word_list(deck_config['id'])
        if not word_list:
            continue
        hint_map = {w['word'].lower(): w.get('hint', '') for w in word_list}
        cards = db.execute(
            """SELECT id, word FROM cards
               WHERE deck_id=?
                 AND (notes IS NULL OR notes='')
                 AND (definition_data IS NULL OR definition_data='')""",
            [deck_config['id']]
        ).fetchall()
        for card in cards:
            hint = hint_map.get(card['word'].lower(), '')
            if hint:
                db.execute("UPDATE cards SET notes=? WHERE id=?", [hint, card['id']])
                updated += 1
    db.commit()
    db.close()
    if updated:
        print(f"[migrate] Populated hints for {updated} existing cards")


def _load_cefr():
    """Load CEFR word levels into _cefr_map.
    Uses a bundled data file if present, otherwise downloads from a public source."""
    global _cefr_map
    cefr_path = os.path.join(DATA_DIR, 'cefr.json')

    # Load from existing file
    if os.path.exists(cefr_path):
        try:
            with open(cefr_path, encoding='utf-8') as f:
                _cefr_map = json.load(f)
            print(f"[cefr] Loaded {len(_cefr_map)} CEFR word levels")
            return
        except Exception:
            pass

    # Download from EFLSoft public CEFR list (word → level JSON)
    try:
        built = {}
        sources = [
            'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv',
            'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv',
        ]
        for url in sources:
            r = requests.get(url, timeout=20)
            if r.status_code != 200:
                continue
            reader = csv.DictReader(io.StringIO(r.text))
            for row in reader:
                word = (row.get('headword') or '').strip().lower()
                level = (row.get('CEFR') or '').strip().upper()
                if not word or level not in CEFR_ORDER:
                    continue
                if word not in built or CEFR_ORDER[level] < CEFR_ORDER[built[word]]:
                    built[word] = level
        if built:
            _cefr_map = built
            with open(cefr_path, 'w', encoding='utf-8') as f:
                json.dump(built, f, ensure_ascii=False, indent=2, sort_keys=True)
            print(f"[cefr] Downloaded {len(built)} CEFR word levels")
            return
    except Exception as e:
        print(f"[cefr] Download failed: {e}")

    # Minimal built-in fallback for very common levels
    _cefr_map = {}
    print("[cefr] No CEFR data available")


def _parse_frequency_pdf():
    """Parse book.pdf — only extracts ranked frequency entries (lines starting with a number)."""
    pdf_path  = os.path.join(os.path.dirname(__file__), 'book.pdf')
    freq_path = os.path.join(DATA_DIR, 'freq_words.json')
    if not os.path.exists(pdf_path):
        return
    try:
        import pdfplumber
        seen         = set()
        ranked_words = {}  # rank (int) → word

        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ''
                for line in text.split('\n'):
                    parts = line.strip().split()
                    if not parts:
                        continue
                    # Only process lines that start with a rank number
                    if parts[0].isdigit() and len(parts) >= 2:
                        rank  = int(parts[0])
                        token = re.sub(r'[^a-z\-]', '', parts[1].lower())
                        if token.isalpha() and 1 < len(token) < 30 and token not in seen:
                            seen.add(token)
                            ranked_words[rank] = token

                # Table extraction: rank in column 0, word in column 1
                for table in (page.extract_tables() or []):
                    for row in (table or []):
                        if not row or len(row) < 2:
                            continue
                        try:
                            rank_str = str(row[0] or '').strip()
                            if not rank_str.isdigit():
                                continue
                            rank     = int(rank_str)
                            word_str = str(row[1] or '').strip().split()[0] if str(row[1] or '').strip() else ''
                            token    = re.sub(r'[^a-z\-]', '', word_str.lower())
                            if token.isalpha() and 1 < len(token) < 30 and token not in seen:
                                seen.add(token)
                                ranked_words[rank] = token
                        except (ValueError, IndexError):
                            continue

        # Output sorted by rank so the list is in true frequency order
        words = [{'word': ranked_words[r], 'pos': '', 'hint': ''}
                 for r in sorted(ranked_words)]

        if len(words) > 100:
            with open(freq_path, 'w', encoding='utf-8') as f:
                json.dump(words[:5000], f, ensure_ascii=False, indent=2)
            print(f"[init] Parsed {len(words)} ranked words from book.pdf")
        else:
            print(f"[init] book.pdf yielded only {len(words)} ranked entries — check format")
    except ImportError:
        print("[init] pdfplumber not available — install with: pip install pdfplumber")
    except Exception as e:
        print(f"[init] PDF parse error: {e}")


# ─────────────────────────────────────────────────────────────
#  ANKI ALGORITHM
# ─────────────────────────────────────────────────────────────

def _format_interval(days):
    if days <= 0:
        return f'<{LEARNING_STEPS_MINUTES[0]}m'
    if days == 1:
        return '1d'
    if days < 30:
        return f'{days}d'
    if days < 365:
        return f'{round(days/30)}mo'
    return f'{round(days/365, 1)}yr'


def _format_due_delta(due_datetime_iso, due_date_iso, phase):
    if phase == 'learning':
        try:
            due_dt = datetime.fromisoformat(due_datetime_iso)
            minutes = max(1, round((due_dt - datetime.now()).total_seconds() / 60))
        except Exception:
            minutes = LEARNING_STEPS_MINUTES[0]
        if minutes <= 1:
            return f'<{LEARNING_STEPS_MINUTES[0]}m'
        if minutes < 60:
            return f'{minutes}m'
        hours = max(1, round(minutes / 60))
        return f'{hours}h'

    try:
        due_d = date.fromisoformat(due_date_iso)
        days = max(0, (due_d - date.today()).days)
    except Exception:
        days = 0
    return _format_interval(days)


def preview_intervals(ease, interval, phase, steps_index):
    """Return human-readable interval strings for all 4 buttons."""
    if phase in ('new', 'learning'):
        again    = f'<{LEARNING_STEPS_MINUTES[0]}m'
        hard     = f'<{LEARNING_STEPS_MINUTES[0]}m'
        next_idx = steps_index + 1
        good     = '1d' if next_idx >= len(LEARNING_STEPS_MINUTES) else f'{LEARNING_STEPS_MINUTES[next_idx]}m'
        easy     = '4d'
    else:
        again = f'<{LEARNING_STEPS_MINUTES[0]}m'
        hard  = _format_interval(max(1, round(interval * 1.2)))
        good  = _format_interval(max(1, round(interval * ease)))
        easy  = _format_interval(max(1, round(interval * ease * 1.3)))
    return {'again': again, 'hard': hard, 'good': good, 'easy': easy}


def anki_review(ease, interval, phase, steps_index, button):
    """
    Core Anki-style spaced repetition update.
    Returns (new_ease, new_interval, new_phase, new_steps_index, due_datetime_iso, due_date_iso)
    """
    now   = datetime.now()
    today = date.today()

    if phase in ('new', 'learning'):
        if button == 'again':
            return (ease, 0, 'learning', 0,
                    (now + timedelta(minutes=LEARNING_STEPS_MINUTES[0])).isoformat(),
                    today.isoformat())
        if button in ('hard', 'good'):
            next_idx = steps_index + (0 if button == 'hard' else 1)
            if next_idx >= len(LEARNING_STEPS_MINUTES):
                new_int = 1
                due_dt  = now + timedelta(days=new_int)
                return (ease, new_int, 'review', 0, due_dt.isoformat(),
                        (today + timedelta(days=new_int)).isoformat())
            mins = LEARNING_STEPS_MINUTES[next_idx]
            return (ease, 0, 'learning', next_idx,
                    (now + timedelta(minutes=mins)).isoformat(), today.isoformat())
        if button == 'easy':
            new_int = 4
            due_dt  = now + timedelta(days=new_int)
            return (ease, new_int, 'review', 0, due_dt.isoformat(),
                    (today + timedelta(days=new_int)).isoformat())

    else:  # review phase
        if button == 'again':
            new_ease = max(1.3, ease - 0.20)
            due_dt   = now + timedelta(minutes=LEARNING_STEPS_MINUTES[0])
            return (round(new_ease, 2), interval, 'learning', 0,
                    due_dt.isoformat(), today.isoformat())
        if button == 'hard':
            new_int  = max(1, min(round(interval * 1.2), 36500))
            new_ease = max(1.3, ease - 0.15)
            due_dt   = now + timedelta(days=new_int)
            return (round(new_ease, 2), new_int, 'review', 0,
                    due_dt.isoformat(), (today + timedelta(days=new_int)).isoformat())
        if button == 'good':
            new_int = max(1, min(round(interval * ease), 36500))
            due_dt  = now + timedelta(days=new_int)
            return (round(ease, 2), new_int, 'review', 0,
                    due_dt.isoformat(), (today + timedelta(days=new_int)).isoformat())
        if button == 'easy':
            new_int  = max(1, min(round(interval * ease * 1.3), 36500))
            new_ease = min(ease + 0.15, 9.9)
            due_dt   = now + timedelta(days=new_int)
            return (round(new_ease, 2), new_int, 'review', 0,
                    due_dt.isoformat(), (today + timedelta(days=new_int)).isoformat())

    return (ease, interval, phase, steps_index, now.isoformat(), today.isoformat())


# ─────────────────────────────────────────────────────────────
#  STREAK
# ─────────────────────────────────────────────────────────────

def calculate_streak(db):
    rows = db.execute("""
        SELECT DISTINCT date(reviewed_at) AS review_date
        FROM review_log
        ORDER BY review_date DESC
    """).fetchall()
    if not rows:
        return 0
    today    = date.today()
    streak   = 0
    expected = today
    for row in rows:
        d = date.fromisoformat(row['review_date'])
        if d == expected:
            streak  += 1
            expected = d - timedelta(days=1)
        elif streak == 0 and d == today - timedelta(days=1):
            streak  += 1
            expected = d - timedelta(days=1)
        else:
            break
    return streak


# ─────────────────────────────────────────────────────────────
#  DICTIONARY HELPERS
# ─────────────────────────────────────────────────────────────

_lookup_cache: dict = {}

_REGISTER_MARKERS = {
    'informal': ('informal', 'colloquial', 'conversational', 'casual'),
    'formal':   ('formal', 'literary', 'archaic', 'dated', 'rare'),
    'slang':    ('slang', 'vulgar', 'offensive'),
    'academic': ('technical', 'medical', 'scientific', 'legal', 'academic'),
}


def _infer_register(meanings):
    """Try to detect register from definition text."""
    text = ' '.join(
        d.get('definition', '').lower()
        for m in meanings
        for d in m.get('definitions', [])
    )
    for reg, markers in _REGISTER_MARKERS.items():
        if any(m in text for m in markers):
            return reg
    return ''


def _strip_html(s):
    return re.sub(r'<[^>]+>', '', s or '').strip()


def _text_or_empty(node):
    return node.get_text(' ', strip=True) if node else ''


def _normalize_audio_url(src, base):
    if not src:
        return ''
    return urljoin(base, src)


def _dictionaryapi_payload(entry, fallback_word):
    all_phonetics = []
    seen_ph = set()
    for p in entry.get('phonetics', []):
        txt = (p.get('text') or '').strip()
        if txt and txt not in seen_ph:
            seen_ph.add(txt)
            all_phonetics.append({'text': txt, 'audio': p.get('audio', '')})

    phonetic = entry.get('phonetic', '') or (all_phonetics[0]['text'] if all_phonetics else '')
    audio_url = next((p.get('audio') for p in entry.get('phonetics', []) if p.get('audio')), '')

    meanings = []
    for m in entry.get('meanings', []):
        defs = []
        for d in m.get('definitions', []):
            defs.append({
                'definition': d.get('definition', ''),
                'example': d.get('example', ''),
                'synonyms': d.get('synonyms', [])[:8],
                'antonyms': d.get('antonyms', [])[:4],
            })
        if defs:
            meanings.append({'partOfSpeech': m.get('partOfSpeech', ''), 'definitions': defs})

    return {
        'word': entry.get('word', fallback_word),
        'phonetic': phonetic,
        'phonetics': all_phonetics,
        'audio_url': audio_url or '',
        'meanings': meanings,
        'register': _infer_register(meanings),
        'source': 'freedict',
    }


def _fetch_dictionaryapi(word_lower, timeout=6):
    r = requests.get(
        f'https://api.dictionaryapi.dev/api/v2/entries/en/{word_lower}',
        timeout=timeout
    )
    if r.status_code == 404:
        return None, 'not_found'
    r.raise_for_status()
    data = r.json()
    if not data:
        return None, 'not_found'
    return _dictionaryapi_payload(data[0], word_lower), None


def _cambridge_payload(word_lower):
    base_url = 'https://dictionary.cambridge.org'
    r = requests.get(
        f'{base_url}/dictionary/english/{quote(word_lower)}',
        timeout=10,
        headers={'User-Agent': 'Mozilla/5.0 (Words Studio)'},
    )
    if r.status_code == 404:
        return None, 'not_found'
    r.raise_for_status()

    soup = BeautifulSoup(r.text, 'html.parser')
    entries = soup.select('.entry-body__el')
    if not entries:
        return None, 'not_found'

    meanings = []
    for entry in entries:
        pos = _text_or_empty(entry.select_one('.posgram .pos, .pos-header .pos, .pos.dpos'))
        defs = []
        for block in entry.select('.def-block'):
            definition = _text_or_empty(block.select_one('.def'))
            if not definition:
                continue
            example = _text_or_empty(block.select_one('.examp.dexamp, .eg.deg'))
            defs.append({'definition': definition, 'example': example, 'synonyms': []})
        if defs:
            meanings.append({'partOfSpeech': pos, 'definitions': defs[:6]})

    if not meanings:
        return None, 'not_found'

    phonetics = []
    for region in ('uk', 'us'):
        ipa = _text_or_empty(entries[0].select_one(f'.{region} .ipa'))
        if ipa and all(p['text'] != ipa for p in phonetics):
            phonetics.append({'text': ipa, 'audio': ''})

    audio_url = ''
    for source in entries[0].select('source[type="audio/mpeg"]'):
        resolved = _normalize_audio_url(source.get('src'), base_url)
        if resolved:
            if '/us_pron/' in resolved:
                audio_url = resolved
                break
            if not audio_url:
                audio_url = resolved

    word = _text_or_empty(soup.select_one('.di-head .hw, .hw.dhw, h1')) or word_lower
    phonetic = phonetics[0]['text'] if phonetics else ''
    return {
        'word': word,
        'phonetic': phonetic,
        'phonetics': phonetics,
        'audio_url': audio_url,
        'meanings': meanings,
        'register': _infer_register(meanings),
        'source': 'cambridge',
    }, None


def _oxford_payload(word_lower):
    base_url = 'https://www.oxfordlearnersdictionaries.com'
    r = requests.get(
        f'{base_url}/definition/english/{quote(word_lower)}',
        timeout=10,
        headers={'User-Agent': 'Mozilla/5.0 (Words Studio)'},
    )
    if r.status_code == 404:
        return None, 'not_found'
    r.raise_for_status()

    soup = BeautifulSoup(r.text, 'html.parser')
    headword = _text_or_empty(soup.select_one('h1'))
    if not headword:
        return None, 'not_found'

    phonetics = []
    for phon in soup.select('.phon'):
        text = _text_or_empty(phon)
        if text and all(p['text'] != text for p in phonetics):
            phonetics.append({'text': text, 'audio': ''})

    audio_url = ''
    for selector in ('.pron-us[data-src-mp3]', '.pron-uk[data-src-mp3]', '[data-src-mp3]'):
        btn = soup.select_one(selector)
        if btn and btn.get('data-src-mp3'):
            audio_url = btn.get('data-src-mp3')
            break

    pos = _text_or_empty(soup.select_one('.webtop .pos, .pos'))
    defs = []
    for sense in soup.select('.sense'):
        definition = _text_or_empty(sense.select_one('.def'))
        if not definition:
            continue
        example = _text_or_empty(sense.select_one('.x'))
        defs.append({'definition': definition, 'example': example, 'synonyms': []})

    if not defs:
        return None, 'not_found'

    meanings = [{'partOfSpeech': pos, 'definitions': defs[:8]}]
    return {
        'word': headword,
        'phonetic': phonetics[0]['text'] if phonetics else '',
        'phonetics': phonetics,
        'audio_url': audio_url,
        'meanings': meanings,
        'register': _infer_register(meanings),
        'source': 'oxford',
    }, None


# ─────────────────────────────────────────────────────────────
#  ROUTES — STATIC PAGE
# ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.before_request
def ensure_app_ready():
    bootstrap_app()


# ─────────────────────────────────────────────────────────────
#  ROUTES — SETTINGS
# ─────────────────────────────────────────────────────────────

@app.route('/api/settings', methods=['GET', 'PUT'])
def settings():
    db = get_db()
    if request.method == 'GET':
        rows = db.execute("SELECT key, value FROM settings").fetchall()
        return jsonify({r['key']: r['value'] for r in rows})
    data = request.get_json() or {}
    for key, value in data.items():
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", [key, str(value)])
    db.commit()
    return jsonify({'ok': True})


# ─────────────────────────────────────────────────────────────
#  ROUTES — STATS
# ─────────────────────────────────────────────────────────────

@app.route('/api/stats')
def stats():
    db    = get_db()
    today = date.today().isoformat()
    now   = datetime.now().isoformat()

    reviewed_today = db.execute(
        "SELECT COUNT(*) FROM review_log WHERE date(reviewed_at) = ? AND button != 'again'", [today]
    ).fetchone()[0]

    total_cards = db.execute(
        "SELECT COUNT(*) FROM cards WHERE is_learning=1"
    ).fetchone()[0]

    total_revised = db.execute(
        """
        SELECT COUNT(*) FROM srs_data s
        JOIN cards c ON c.id = s.card_id
        WHERE c.is_learning=1 AND s.phase IN ('learning', 'review')
        """
    ).fetchone()[0]

    total_learned = db.execute(
        """
        SELECT COUNT(*) FROM srs_data s
        JOIN cards c ON c.id = s.card_id
        WHERE c.is_learning=1 AND s.phase='review'
        """
    ).fetchone()[0]

    due_now = db.execute("""
        SELECT COUNT(*) FROM srs_data s
        JOIN cards c ON c.id = s.card_id
        WHERE c.is_learning=1
          AND ((s.phase = 'new'      AND s.due_date     <= ?)
            OR (s.phase = 'learning' AND s.due_datetime <= ?)
            OR (s.phase = 'review'   AND s.due_date     <= ?))
    """, [today, now, today]).fetchone()[0]

    streak     = calculate_streak(db)
    goal_row   = db.execute("SELECT value FROM settings WHERE key='daily_goal'").fetchone()
    daily_goal = int(goal_row['value']) if goal_row else 20

    upcoming = []
    for i in range(7):
        d = (date.today() + timedelta(days=i)).isoformat()
        count = db.execute(
            """
            SELECT COUNT(*) FROM srs_data s
            JOIN cards c ON c.id = s.card_id
            WHERE c.is_learning=1 AND s.due_date=? AND s.phase='review'
            """,
            [d]
        ).fetchone()[0]
        upcoming.append({'date': d, 'count': count})

    return jsonify({
        'streak':         streak,
        'reviewed_today': reviewed_today,
        'daily_goal':     daily_goal,
        'total_cards':    total_cards,
        'total_revised':  total_revised,
        'total_learned':  total_learned,
        'due_now':        due_now,
        'upcoming_7d':    upcoming,
    })


# ─────────────────────────────────────────────────────────────
#  ROUTES — DICTIONARY LOOKUP
# ─────────────────────────────────────────────────────────────

@app.route('/api/lookup/<path:word>')
def lookup_word(word):
    word_lower = word.lower().strip()
    if word_lower in _lookup_cache:
        return jsonify(_lookup_cache[word_lower])
    try:
        result, error = _fetch_dictionaryapi(word_lower, timeout=6)
        if error == 'not_found':
            return jsonify({'error': 'not_found'}), 404
    except requests.RequestException:
        return jsonify({'error': 'api_unavailable'}), 503
    _lookup_cache[word_lower] = result
    return jsonify(result)


@app.route('/api/lookup-wiktionary/<path:word>')
def lookup_wiktionary(word):
    word_lower = word.lower().strip()
    cache_key  = f'wiki_{word_lower}'
    if cache_key in _lookup_cache:
        return jsonify(_lookup_cache[cache_key])
    try:
        r = requests.get(
            f'https://en.wiktionary.org/api/rest_v1/page/definition/{word_lower}',
            timeout=8,
            headers={'User-Agent': 'WordsApp/1.0 (vocabulary learning app)'},
        )
        if r.status_code == 404:
            return jsonify({'error': 'not_found'}), 404
        r.raise_for_status()
        data = r.json()
    except requests.RequestException:
        return jsonify({'error': 'api_unavailable'}), 503

    meanings = []
    for section in data.get('en', []):
        pos  = section.get('partOfSpeech', '')
        defs = []
        for d in section.get('definitions', []):
            definition = _strip_html(d.get('definition', ''))
            if not definition:
                continue
            raw_examples = d.get('examples', d.get('parsedExamples', []))
            example = _strip_html(raw_examples[0]) if raw_examples else ''
            defs.append({'definition': definition, 'example': example, 'synonyms': []})
        if defs:
            meanings.append({'partOfSpeech': pos, 'definitions': defs})

    result = {
        'word':      word_lower,
        'phonetic':  '',
        'phonetics': [],
        'audio_url': None,
        'meanings':  meanings,
        'register':  _infer_register(meanings),
        'source':    'wiktionary',
    }
    _lookup_cache[cache_key] = result
    return jsonify(result)


@app.route('/api/lookup-cambridge/<path:word>')
def lookup_cambridge(word):
    word_lower = word.lower().strip()
    cache_key = f'cambridge_{word_lower}'
    if cache_key in _lookup_cache:
        return jsonify(_lookup_cache[cache_key])
    try:
        result, error = _cambridge_payload(word_lower)
        if error == 'not_found':
            return jsonify({'error': 'not_found'}), 404
    except requests.RequestException:
        return jsonify({'error': 'api_unavailable'}), 503
    _lookup_cache[cache_key] = result
    return jsonify(result)


@app.route('/api/lookup-oxford/<path:word>')
def lookup_oxford(word):
    word_lower = word.lower().strip()
    cache_key = f'oxford_{word_lower}'
    if cache_key in _lookup_cache:
        return jsonify(_lookup_cache[cache_key])
    try:
        result, error = _oxford_payload(word_lower)
        if error == 'not_found':
            return jsonify({'error': 'not_found'}), 404
    except requests.RequestException:
        return jsonify({'error': 'api_unavailable'}), 503
    _lookup_cache[cache_key] = result
    return jsonify(result)


# ─────────────────────────────────────────────────────────────
#  ROUTES — DECKS
# ─────────────────────────────────────────────────────────────

@app.route('/api/decks', methods=['GET'])
def get_decks():
    db    = get_db()
    today = date.today().isoformat()
    now   = datetime.now().isoformat()

    decks  = db.execute("SELECT * FROM decks ORDER BY is_builtin DESC, id").fetchall()
    result = []
    for deck in decks:
        d = dict(deck)
        if deck['is_builtin']:
            total = len(load_word_list(deck['id']))
        else:
            total = db.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id=?", [deck['id']]
            ).fetchone()[0]

        revised = db.execute("""
            SELECT COUNT(*) FROM srs_data s
            JOIN cards c ON c.id = s.card_id
            WHERE c.deck_id=? AND c.is_learning=1 AND s.phase IN ('learning', 'review')
        """, [deck['id']]).fetchone()[0]

        learned = db.execute("""
            SELECT COUNT(*) FROM srs_data s
            JOIN cards c ON c.id = s.card_id
            WHERE c.deck_id=? AND c.is_learning=1 AND s.phase='review'
        """, [deck['id']]).fetchone()[0]

        due = db.execute("""
            SELECT COUNT(*) FROM srs_data s
            JOIN cards c ON c.id = s.card_id
            WHERE c.deck_id=? AND c.is_learning=1
              AND ((s.phase='new'      AND s.due_date    <=?)
                OR (s.phase='learning' AND s.due_datetime<=?)
                OR (s.phase='review'   AND s.due_date    <=?))
        """, [deck['id'], today, now, today]).fetchone()[0]

        d['total_words']   = total
        d['revised_count'] = revised
        d['learned_count'] = learned
        d['due_count']     = due
        d['progress_pct']  = round(revised / total * 100, 1) if total > 0 else 0
        result.append(d)

    return jsonify({'decks': result})


@app.route('/api/decks', methods=['POST'])
def create_deck():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    db   = get_db()
    cur  = db.execute(
        "INSERT INTO decks (name, description) VALUES (?,?)",
        [name[:60], (data.get('description') or '').strip()]
    )
    db.commit()
    row = db.execute("SELECT * FROM decks WHERE id=?", [cur.lastrowid]).fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/decks/<int:deck_id>', methods=['DELETE'])
def delete_deck(deck_id):
    db   = get_db()
    deck = db.execute("SELECT * FROM decks WHERE id=?", [deck_id]).fetchone()
    if not deck:
        return jsonify({'error': 'not found'}), 404
    if deck['is_builtin']:
        return jsonify({'error': 'Cannot delete built-in decks'}), 403
    # Delete cards first (srs_data cascades via ON DELETE CASCADE on card_id)
    db.execute("DELETE FROM cards WHERE deck_id=?", [deck_id])
    db.execute("DELETE FROM decks WHERE id=?", [deck_id])
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/decks/<int:deck_id>/words')
def deck_words(deck_id):
    db       = get_db()
    page     = max(1, int(request.args.get('page', 1)))
    per_page = min(5000, int(request.args.get('per_page', 50)))
    include_all = request.args.get('all', '').lower() in ('1', 'true', 'yes')
    search   = request.args.get('search', '').lower().strip()
    filt     = request.args.get('filter', 'all')
    cefr_mode = request.args.get('cefr_mode', 'all').strip().lower()
    cefr_level = request.args.get('cefr_level', '').strip().upper()

    deck = db.execute("SELECT * FROM decks WHERE id=?", [deck_id]).fetchone()
    if not deck:
        return jsonify({'error': 'not found'}), 404

    db_rows = db.execute("""
        SELECT c.id, c.word, c.phonetic, c.notes, c.is_learning,
               s.phase, s.interval, s.ease_factor, s.due_date
        FROM cards c
        LEFT JOIN srs_data s ON s.card_id = c.id
        WHERE c.deck_id=?
        ORDER BY lower(c.word)
    """, [deck_id]).fetchall()
    db_map = {row['word'].lower(): dict(row) for row in db_rows}

    if deck['is_builtin']:
        word_list = load_word_list(deck_id)
        all_words = []
        for w in word_list:
            wl       = w['word'].lower()
            db_entry = db_map.get(wl)
            all_words.append({
                'word':     w['word'],
                'pos':      w.get('pos', ''),
                'hint':     w.get('hint', ''),
                'notes':    (db_entry['notes'] if db_entry and db_entry.get('notes') else '') or w.get('hint', ''),
                'is_added': bool(db_entry and db_entry.get('is_learning')),
                'is_learning': bool(db_entry and db_entry.get('is_learning')),
                'card_id':  db_entry['id']    if db_entry else None,
                'phase':    db_entry['phase'] if db_entry and db_entry.get('is_learning') else None,
                'stage':    _stage_for_phase(db_entry['phase']) if db_entry and db_entry.get('is_learning') else 'inactive',
                'phonetic': db_entry['phonetic'] if db_entry else '',
                'cefr_level': _cefr_level_for(w['word']),
            })
    else:
        all_words = [{
            'word': e['word'],
            'pos': '',
            'hint': e.get('notes', '') or '',
            'notes': e.get('notes', '') or '',
            'is_added': bool(e.get('is_learning')),
            'is_learning': bool(e.get('is_learning')),
            'card_id': e['id'],
            'phase': e['phase'] if e.get('is_learning') else None,
            'stage': _stage_for_phase(e['phase']) if e.get('is_learning') else 'inactive',
            'phonetic': e.get('phonetic', '') or '',
            'cefr_level': _cefr_level_for(e['word']),
        } for e in db_map.values()]

    if search:
        all_words = [
            w for w in all_words
            if search in w['word'].lower()
            or search in (w.get('hint') or '').lower()
            or search in (w.get('notes') or '').lower()
        ]
    if filt == 'added':
        all_words = [w for w in all_words if w.get('is_learning')]
    elif filt == 'unlearned':
        all_words = [w for w in all_words if not w.get('is_learning')]
    elif filt not in ('', 'all'):
        all_words = [
            w for w in all_words
            if _stage_matches(w.get('phase'), filt)
        ]

    if cefr_mode not in ('', 'all') or cefr_level:
        all_words = [
            w for w in all_words
            if _cefr_matches(w.get('cefr_level', ''), cefr_mode, cefr_level)
        ]

    total     = len(all_words)
    offset    = (page - 1) * per_page
    paginated = all_words if include_all else all_words[offset: offset + per_page]
    return jsonify({'words': paginated, 'total': total, 'page': page, 'per_page': per_page})


@app.route('/api/decks/<int:deck_id>/add-words', methods=['POST'])
def add_words_to_deck(deck_id):
    data   = request.get_json() or {}
    words  = data.get('words', [])
    db     = get_db()
    deck   = db.execute("SELECT * FROM decks WHERE id=?", [deck_id]).fetchone()
    added  = 0
    failed = []
    hint_map = {}

    if not deck:
        return jsonify({'error': 'not found'}), 404
    if deck['is_builtin']:
        hint_map = {
            x['word'].lower(): x.get('hint', '')
            for x in load_word_list(deck_id)
        }

    for word in words:
        try:
            word = word.strip()
            if not word:
                continue
            existing = db.execute(
                "SELECT id, is_learning FROM cards WHERE lower(word)=lower(?) AND deck_id=?",
                [word, deck_id]
            ).fetchone()
            if existing:
                if existing['is_learning']:
                    continue
                _reset_card_learning_state(db, existing['id'])
                added += 1
                continue
            wl = word.lower()

            # Use cache; if not cached, attempt live lookup
            lk = _lookup_cache.get(wl)
            if not lk:
                try:
                    lk, _ = _fetch_dictionaryapi(wl, timeout=5)
                    if lk:
                        _lookup_cache[wl] = lk
                except Exception:
                    lk = {}

            phonetic        = (lk or {}).get('phonetic', '')
            audio_url       = (lk or {}).get('audio_url', '')
            definition_data = None
            if lk and lk.get('meanings'):
                definition_data = json.dumps({'meanings': lk['meanings']})

            # Fallback: store hint from word list as notes when no definition available
            notes = None
            if not definition_data:
                notes = hint_map.get(wl, '') or None

            cur = db.execute(
                "INSERT INTO cards (word, phonetic, audio_url, deck_id, is_learning, definition_data, notes) VALUES (?,?,?,?,?,?,?)",
                [word, phonetic, audio_url, deck_id, 1, definition_data, notes]
            )
            db.execute("INSERT INTO srs_data (card_id) VALUES (?)", [cur.lastrowid])
            added += 1
        except Exception as exc:
            failed.append({'word': word, 'error': str(exc)})

    db.commit()
    return jsonify({'added': added, 'failed': failed})


@app.route('/api/decks/<int:deck_id>/add-all', methods=['POST'])
def add_all_words(deck_id):
    data = request.get_json() or {}
    db   = get_db()
    deck = db.execute("SELECT * FROM decks WHERE id=?", [deck_id]).fetchone()
    if not deck or not deck['is_builtin']:
        return jsonify({'error': 'not found or not builtin'}), 404

    word_list = load_word_list(deck_id)
    search = (data.get('search') or '').strip().lower()
    filt = (data.get('filter') or 'all').strip().lower()
    cefr_mode = (data.get('cefr_mode') or 'all').strip().lower()
    cefr_level = (data.get('cefr_level') or '').strip().upper()
    existing_rows = db.execute(
        """
        SELECT c.id, c.word, c.is_learning, s.phase
        FROM cards c
        LEFT JOIN srs_data s ON s.card_id = c.id
        WHERE c.deck_id=?
        """,
        [deck_id]
    ).fetchall()
    existing_map = {r['word'].lower(): dict(r) for r in existing_rows}

    added = 0
    already_had = 0
    for w in word_list:
        word_key = w['word'].lower()
        existing = existing_map.get(word_key)
        is_learning = bool(existing and existing.get('is_learning'))
        phase = existing.get('phase') if is_learning and existing else None
        if search:
            haystack = ' '.join([
                w.get('word', ''),
                w.get('hint', '') or '',
            ]).lower()
            if search not in haystack:
                continue
        if filt == 'added':
            if not is_learning:
                continue
        elif filt == 'unlearned':
            if is_learning:
                continue
        elif filt not in ('', 'all'):
            if not _stage_matches(phase, filt):
                continue
        if not _cefr_matches(_cefr_level_for(w['word']), cefr_mode, cefr_level):
            continue
        if existing and existing.get('is_learning'):
            already_had += 1
            continue
        if existing and not existing.get('is_learning'):
            _reset_card_learning_state(db, existing['id'])
            added += 1
            continue
        cur = db.execute(
            "INSERT INTO cards (word, deck_id, is_learning, notes) VALUES (?,?,?,?)",
            [w['word'], deck_id, 1, w.get('hint') or None]
        )
        db.execute("INSERT INTO srs_data (card_id) VALUES (?)", [cur.lastrowid])
        existing_map[word_key] = {'id': cur.lastrowid, 'is_learning': 1}
        added += 1

    db.commit()
    return jsonify({'added': added, 'already_had': already_had})


@app.route('/api/decks/<int:deck_id>/remove-words', methods=['POST'])
def remove_words_from_deck(deck_id):
    """Archive specific cards from active learning while keeping them in the deck."""
    data     = request.get_json() or {}
    card_ids = data.get('card_ids', [])
    db       = get_db()
    removed  = 0

    for cid in card_ids:
        result = db.execute(
            "UPDATE cards SET is_learning=0 WHERE id=? AND deck_id=? AND is_learning=1",
            [cid, deck_id]
        )
        removed += result.rowcount

    db.commit()
    return jsonify({'removed': removed})


@app.route('/api/learning-words')
def learning_words():
    db = get_db()
    search = request.args.get('search', '').lower().strip()
    deck_id = request.args.get('deck_id', '').strip()
    phase = request.args.get('phase', 'all').strip().lower()
    cefr_mode = request.args.get('cefr_mode', 'all').strip().lower()
    cefr_level = request.args.get('cefr_level', '').strip().upper()

    rows = db.execute("""
        SELECT c.id AS card_id, c.word, c.deck_id, c.phonetic, c.notes,
               d.name AS deck_name, d.is_builtin, s.phase
        FROM cards c
        JOIN decks d ON d.id = c.deck_id
        JOIN srs_data s ON s.card_id = c.id
        WHERE c.is_learning=1
        ORDER BY d.is_builtin DESC, lower(d.name), lower(c.word)
    """).fetchall()

    words = []
    for row in rows:
        item = dict(row)
        item['is_builtin'] = bool(item['is_builtin'])
        item['cefr_level'] = _cefr_level_for(item['word'])
        item['stage'] = _stage_for_phase(item.get('phase'))
        if deck_id and str(item['deck_id']) != deck_id:
            continue
        if not _stage_matches(item.get('phase'), phase):
            continue
        if not _cefr_matches(item.get('cefr_level', ''), cefr_mode, cefr_level):
            continue
        haystack = ' '.join([
            item.get('word', ''),
            item.get('deck_name', ''),
            item.get('notes', '') or '',
        ]).lower()
        if search and search not in haystack:
            continue
        words.append(item)

    return jsonify({'words': words, 'total': len(words)})


# ─────────────────────────────────────────────────────────────
#  ROUTES — CARDS
# ─────────────────────────────────────────────────────────────

@app.route('/api/cards/due')
def cards_due():
    db      = get_db()
    today   = date.today().isoformat()
    now     = datetime.now().isoformat()
    deck_id = request.args.get('deck_id')
    limit   = int(request.args.get('limit', 9999))

    deck_clause = "AND c.deck_id=?" if deck_id else ""
    deck_params = [deck_id]        if deck_id else []

    rows = db.execute(f"""
        SELECT c.*, d.name AS deck_name,
               s.ease_factor, s.interval, s.phase, s.steps_index,
               s.due_datetime, s.due_date, s.total_reviews, s.correct_reviews,
               s.show_definition_first
        FROM cards c
        LEFT JOIN decks d ON d.id = c.deck_id
        JOIN srs_data s ON s.card_id = c.id
        WHERE c.is_learning=1
          AND ((s.phase='new'      AND s.due_date    <=?)
            OR (s.phase='learning' AND s.due_datetime<=?)
            OR (s.phase='review'   AND s.due_date    <=?))
        {deck_clause}
        ORDER BY
            CASE s.phase WHEN 'learning' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
            s.due_datetime, s.due_date
        LIMIT ?
    """, [today, now, today] + deck_params + [limit]).fetchall()

    import random
    cards = []
    for row in rows:
        card = _serialize_card_row(row)
        card['show_definition_first'] = random.random() < 0.3 and _card_has_prompt(
            card.get('definition_data'), card.get('notes')
        )
        card['preview_intervals']     = preview_intervals(
            card['ease_factor'], card['interval'],
            card['phase'], card['steps_index']
        )
        cards.append(card)

    total_due = db.execute(f"""
        SELECT COUNT(*) FROM cards c
        JOIN srs_data s ON s.card_id = c.id
        WHERE c.is_learning=1
          AND ((s.phase='new'      AND s.due_date    <=?)
            OR (s.phase='learning' AND s.due_datetime<=?)
            OR (s.phase='review'   AND s.due_date    <=?))
        {deck_clause}
    """, [today, now, today] + deck_params).fetchone()[0]

    return jsonify({'cards': cards, 'total_due': total_due})


@app.route('/api/cards/<int:card_id>/enrich', methods=['POST'])
def enrich_card(card_id):
    """Fetch definition from dictionary API and save it if the card has none."""
    db   = get_db()
    card = db.execute("SELECT * FROM cards WHERE id=?", [card_id]).fetchone()
    if not card:
        return jsonify({'error': 'not found'}), 404

    if card['definition_data']:
        try:
            dd = json.loads(card['definition_data'])
        except Exception:
            dd = None
        return jsonify({
            'id': card_id,
            'definition_data': dd,
            'phonetic': card['phonetic'],
            'audio_url': card['audio_url'] or '',
        })

    word = card['word'].lower()
    try:
        payload, error = _fetch_dictionaryapi(word, timeout=8)
        if error == 'not_found' or not payload:
            return jsonify({'error': 'not found'}), 404
        ph = payload.get('phonetic', '')
        ms = payload.get('meanings', [])
        if not ms:
            return jsonify({'error': 'no definitions found'}), 404
        dd = {'meanings': ms}
        db.execute(
            """
            UPDATE cards
            SET definition_data=?,
                phonetic=COALESCE(NULLIF(?, ''), phonetic),
                audio_url=COALESCE(NULLIF(?, ''), audio_url)
            WHERE id=?
            """,
            [json.dumps(dd), ph, payload.get('audio_url', ''), card_id]
        )
        db.commit()
        return jsonify({
            'id': card_id,
            'definition_data': dd,
            'phonetic': ph,
            'audio_url': payload.get('audio_url', ''),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cards', methods=['POST'])
def create_card():
    data = request.get_json() or {}
    db   = get_db()
    word = data.get('word', '').strip()
    if not word:
        return jsonify({'error': 'word is required'}), 400

    deck_id = data.get('deck_id')
    if not deck_id:
        my_words = db.execute(
            "SELECT id FROM decks WHERE name='My Words' AND is_builtin=0"
        ).fetchone()
        deck_id = my_words['id'] if my_words else None

    if deck_id:
        deck = db.execute("SELECT id FROM decks WHERE id=?", [deck_id]).fetchone()
        if not deck:
            deck_id = None

    if not deck_id:
        cur     = db.execute(
            "INSERT INTO decks (name, description) VALUES "
            "('My Words','Your personal word collection')"
        )
        deck_id = cur.lastrowid

    existing = db.execute(
        "SELECT id, is_learning FROM cards WHERE lower(word)=lower(?) AND deck_id=?",
        [word, deck_id]
    ).fetchone()
    if existing:
        if existing['is_learning']:
            return jsonify({'error': 'already_exists', 'card_id': existing['id']}), 409
        _reset_card_learning_state(db, existing['id'])
        db.commit()
        return jsonify({'id': existing['id'], 'word': word, 'reactivated': True}), 200

    def_data = data.get('definition_data')
    if isinstance(def_data, (dict, list)):
        def_data = json.dumps(def_data)

    colls = data.get('collocations', [])
    if isinstance(colls, list):
        colls = json.dumps(colls)

    cur = db.execute(
        "INSERT INTO cards (word, phonetic, audio_url, deck_id, is_learning, definition_data, collocations, register, notes) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        [word, data.get('phonetic', ''), data.get('audio_url', ''), deck_id, 1,
         def_data, colls, data.get('register', ''), data.get('notes', '')]
    )
    card_id = cur.lastrowid
    db.execute("INSERT INTO srs_data (card_id) VALUES (?)", [card_id])
    db.commit()
    return jsonify({'id': card_id, 'word': word}), 201


@app.route('/api/cards/<int:card_id>', methods=['PUT'])
def update_card(card_id):
    data = request.get_json() or {}
    db   = get_db()
    card = db.execute("SELECT id FROM cards WHERE id=?", [card_id]).fetchone()
    if not card:
        return jsonify({'error': 'not found'}), 404

    updates = {k: v for k, v in data.items()
               if k in ('notes', 'register', 'phonetic', 'audio_url')}
    if 'definition_data' in data:
        updates['definition_data'] = (json.dumps(data['definition_data'])
                                      if isinstance(data['definition_data'], (dict, list))
                                      else data['definition_data'])
    if 'collocations' in data:
        updates['collocations'] = (json.dumps(data['collocations'])
                                   if isinstance(data['collocations'], list)
                                   else data['collocations'])
    if updates:
        sets = ', '.join(f'{k}=?' for k in updates)
        db.execute(f"UPDATE cards SET {sets} WHERE id=?",
                   list(updates.values()) + [card_id])
        db.commit()

    row = db.execute("SELECT * FROM cards WHERE id=?", [card_id]).fetchone()
    return jsonify(_serialize_card_row(row))


@app.route('/api/cards/<int:card_id>', methods=['DELETE'])
def delete_card(card_id):
    db = get_db()
    row = db.execute("""
        SELECT c.id, d.is_builtin
        FROM cards c
        LEFT JOIN decks d ON d.id = c.deck_id
        WHERE c.id=?
    """, [card_id]).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    if row['is_builtin']:
        return jsonify({'error': 'Cannot permanently delete built-in deck words'}), 403
    db.execute("DELETE FROM cards WHERE id=?", [card_id])
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/cards/remove-from-learning', methods=['POST'])
def remove_cards_from_learning():
    data = request.get_json() or {}
    card_ids = data.get('card_ids', [])
    db = get_db()
    removed = 0
    for cid in card_ids:
        result = db.execute(
            "UPDATE cards SET is_learning=0 WHERE id=? AND is_learning=1",
            [cid]
        )
        removed += result.rowcount
    db.commit()
    return jsonify({'removed': removed})


@app.route('/api/cards/permanent-delete', methods=['POST'])
def permanent_delete_cards():
    data = request.get_json() or {}
    card_ids = data.get('card_ids', [])
    db = get_db()
    deleted = 0
    skipped_builtin = 0
    for cid in card_ids:
        row = db.execute("""
            SELECT c.id, d.is_builtin
            FROM cards c
            LEFT JOIN decks d ON d.id = c.deck_id
            WHERE c.id=?
        """, [cid]).fetchone()
        if not row:
            continue
        if row['is_builtin']:
            skipped_builtin += 1
            continue
        result = db.execute("DELETE FROM cards WHERE id=?", [cid])
        deleted += result.rowcount
    db.commit()
    return jsonify({'deleted': deleted, 'skipped_builtin': skipped_builtin})


@app.route('/api/cards/<int:card_id>/review', methods=['POST'])
def review_card(card_id):
    data   = request.get_json() or {}
    button = data.get('button', 'good')
    if button not in ('again', 'hard', 'good', 'easy'):
        return jsonify({'error': 'invalid button'}), 400

    db  = get_db()
    card = db.execute("SELECT id, is_learning FROM cards WHERE id=?", [card_id]).fetchone()
    if not card or not card['is_learning']:
        return jsonify({'error': 'not found'}), 404
    srs = db.execute("SELECT * FROM srs_data WHERE card_id=?", [card_id]).fetchone()
    if not srs:
        return jsonify({'error': 'not found'}), 404

    interval_before = srs['interval']
    new_ease, new_int, new_phase, new_steps, due_dt, due_d = anki_review(
        srs['ease_factor'], srs['interval'],
        srs['phase'], srs['steps_index'], button
    )
    is_correct = button != 'again'

    db.execute("""
        UPDATE srs_data
        SET ease_factor=?, interval=?, phase=?, steps_index=?,
            due_datetime=?, due_date=?,
            last_reviewed=datetime('now'),
            total_reviews=total_reviews+1,
            correct_reviews=correct_reviews+?
        WHERE card_id=?
    """, [new_ease, new_int, new_phase, new_steps,
          due_dt, due_d, 1 if is_correct else 0, card_id])

    db.execute("""
        INSERT INTO review_log (card_id, button, interval_before, interval_after)
        VALUES (?,?,?,?)
    """, [card_id, button, interval_before, new_int])

    db.commit()

    display_next = _format_due_delta(due_dt, due_d, new_phase)

    return jsonify({
        'new_interval':    new_int,
        'new_ease_factor': new_ease,
        'new_phase':       new_phase,
        'new_due_date':    due_d,
        'display_next':    display_next,
        'is_correct':      is_correct,
    })


@app.route('/api/cards/<int:card_id>/preview-intervals')
def preview_card_intervals(card_id):
    db  = get_db()
    card = db.execute("SELECT id, is_learning FROM cards WHERE id=?", [card_id]).fetchone()
    if not card or not card['is_learning']:
        return jsonify({'error': 'not found'}), 404
    srs = db.execute("SELECT * FROM srs_data WHERE card_id=?", [card_id]).fetchone()
    if not srs:
        return jsonify({'error': 'not found'}), 404
    return jsonify(preview_intervals(
        srs['ease_factor'], srs['interval'], srs['phase'], srs['steps_index']
    ))


# ─────────────────────────────────────────────────────────────
#  ERROR HANDLERS
# ─────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'not found'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': str(e)}), 500


# ─────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    bootstrap_app()
    import webbrowser, threading
    threading.Timer(1.2, lambda: webbrowser.open('http://localhost:5000')).start()
    print("\n  ✦  English Words App running at http://localhost:5000\n")
    app.run(debug=False, port=5000, use_reloader=False)
