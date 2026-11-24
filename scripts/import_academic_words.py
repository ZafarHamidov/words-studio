"""Extract the bundled AWL PDF, cache dictionary lookups, and import a study deck.

Run with --fetch to download dictionary data, then --import-deck to save cards.
Lookups are resumable; no API key is needed. Existing cards and review history
are preserved. Original dictionary definitions stay paired with their examples.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
import sys
import time

import fitz
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import _cambridge_payload, _dictionaryapi_payload  # noqa: E402

PDF = ROOT / 'Academic Word List 570 words_0.pdf'
OUTPUT = ROOT / 'data' / 'academic_words.json'
CACHE = ROOT / '.tmp' / 'academic_dictionary_cache'
DECK_NAME = 'Academic Word List (570 words)'


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def extract_words(path=PDF):
    entries = []
    with fitz.open(path) as document:
        for page_number, page in enumerate(document, 1):
            rows = {}
            for token in page.get_text('words'):
                # The two table columns start at x=110 and x=199 respectively.
                # Ignore the running header and page footer.
                if 70 < token[1] < 710:
                    row = rows.setdefault(round(token[1], 1), [[], []])
                    row[int(token[0] > 198)].append(token[4])
            for _, (left, right) in sorted(rows.items()):
                word = ' '.join(left).strip().lower()
                hint = ' '.join(right).strip()
                # The PDF uses a non-printing glyph for this hyphen.
                word = re.sub(r'^so[^a-z]+called$', 'so-called', word)
                if not re.fullmatch(r'[a-z]+(?:-[a-z]+)*', word) or not hint:
                    raise ValueError(f'Invalid table row on page {page_number}: {word!r}, {hint!r}')
                entries.append({'word': word, 'pos': '', 'hint': hint, 'pdf_page': page_number})
    if len(entries) != 570 or len({entry['word'] for entry in entries}) != 570:
        raise ValueError(f'Expected 570 unique words, extracted {len(entries)} rows')
    return entries


def is_sentence(text):
    """Prefer complete usage sentences over dictionary phrase fragments."""
    text = (text or '').strip()
    return len(text.split()) >= 4 and bool(re.search(r'[.!?][\"\u201d\u2019\')]*$', text))


def has_example(payload):
    return any(is_sentence(definition.get('example', ''))
               for meaning in (payload or {}).get('meanings', [])
               for definition in meaning.get('definitions', []))


def fetch_free_dictionary(word):
    url = f'https://api.dictionaryapi.dev/api/v2/entries/en/{requests.utils.quote(word)}'
    for attempt in range(3):
        response = requests.get(url, timeout=15)
        if response.status_code == 429 or response.status_code >= 500:
            if attempt < 2:
                time.sleep(min(float(response.headers.get('Retry-After', 2 ** attempt)), 30))
                continue
        if response.status_code == 404:
            return None
        response.raise_for_status()
        entries = response.json()
        if not entries:
            return None
        payload = _dictionaryapi_payload(entries[0], word)
        # Homographs can have examples in later entries, not just data[0].
        for entry in entries[1:]:
            payload['meanings'].extend(_dictionaryapi_payload(entry, word)['meanings'])
        payload['source_url'] = url
        payload['source_urls'] = list(dict.fromkeys(
            link for entry in entries for link in entry.get('sourceUrls', [])))
        payload['licenses'] = [entry['license'] for entry in entries if entry.get('license')]
        return payload


def base_forms(word, payloads):
    candidates = []
    for payload in payloads:
        for meaning in (payload or {}).get('meanings', []):
            for definition in meaning.get('definitions', []):
                text = definition.get('definition', '').lower().strip()
                if any(marker in text for marker in ('plural', 'participle', 'past tense', 'past simple')):
                    match = re.search(r'\bof ([a-z-]+)\b', text)
                    if match:
                        candidates.append(match.group(1))
                match = re.fullmatch(r'a single ([a-z-]+)\.?', text)
                if match:
                    candidates.append(match.group(1))
    candidates.extend({'sought': ['seek'], 'criteria': ['criterion']}.get(word, []))
    if word.endswith('ies'):
        candidates.append(word[:-3] + 'y')
    if word.endswith('s') and not word.endswith('ss'):
        candidates.append(word[:-1])
    if word.endswith('es'):
        candidates.append(word[:-2])
    if word.endswith('ed'):
        candidates.extend([word[:-1], word[:-2]])
    return list(dict.fromkeys(candidate for candidate in candidates if candidate != word and len(candidate) > 2))


def fetch_cambridge(word):
    payload, error = _cambridge_payload(word)
    if payload:
        payload['source_url'] = f'https://dictionary.cambridge.org/dictionary/english/{word}'
    return payload, error


def lookup(entry, fallback=False):
    word = entry['word']
    cache_path = CACHE / f'{word}.json'
    cached = json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else None
    if cached and has_example(cached.get('payload')):
        return cached
    if cached and not fallback and not cached.get('error'):
        return cached
    result = cached or {'word': word, 'payload': None}
    try:
        if not cached or cached.get('error'):
            result['payload'] = fetch_free_dictionary(word)
        if fallback and not has_example(result['payload']):
            # Reuse the project's existing Cambridge dictionary adapter for
            # inflected headwords and API entries with no usage examples.
            payload, error = fetch_cambridge(word)
            if payload and has_example(payload):
                result['payload'] = payload
                result.pop('fallback_error', None)
            elif error:
                result['fallback_error'] = error
            if not has_example(result['payload']):
                for base in base_forms(word, [result['payload'], payload]):
                    base_payload = fetch_free_dictionary(base)
                    if not has_example(base_payload):
                        base_payload, _ = fetch_cambridge(base)
                    if has_example(base_payload):
                        result['payload'] = base_payload
                        result['lookup_headword'] = base
                        result.pop('fallback_error', None)
                        break
        result.pop('error', None)
    except (requests.RequestException, ValueError) as exc:
        result['error'] = str(exc)
    result['fetched_at'] = datetime.now(timezone.utc).isoformat()
    write_json(cache_path, result)
    return result


def build_payload(entries):
    for entry in entries:
        path = CACHE / f"{entry['word']}.json"
        cached = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        payload = cached.get('payload') or {}
        if payload:
            entry['phonetic'] = payload.get('phonetic', '')
            entry['audio_url'] = payload.get('audio_url', '')
            entry['dictionary_source'] = payload.get('source', '')
            entry['dictionary_url'] = payload.get('source_url', '')
            meanings = payload.get('meanings', [])
            for meaning in meanings:
                for definition in meaning.get('definitions', []):
                    # Cambridge's HTML text extraction adds spaces before
                    # punctuation; normalize spacing without rewriting usage.
                    example = definition.get('example', '')
                    example = re.sub(r'\s+([,.;:!?])', r'\1', example)
                    example = re.sub(r'\(\s+', '(', example)
                    definition['example'] = re.sub(r'\s+\)', ')', example)
                # Put examples within the first two definitions, which are
                # the definitions displayed on the current study card UI.
                meaning['definitions'].sort(key=lambda definition: (
                    is_sentence(definition.get('example')),
                    bool(definition.get('example')),
                ), reverse=True)
            entry['definition_data'] = {
                'meanings': meanings,
                'source': payload.get('source', ''),
                'source_url': payload.get('source_url', ''),
                'source_urls': payload.get('source_urls', []),
                'licenses': payload.get('licenses', []),
                'headword': cached.get('lookup_headword', entry['word']),
            }
            entry['pos'] = meanings[0].get('partOfSpeech', '') if meanings else ''
        entry['has_dictionary_example'] = has_example(payload)
    return entries


def import_deck(entries, database):
    # sqlite backup is safe even if the Flask app currently has the DB open.
    backup = ROOT / 'data' / 'backups' / f"words-before-academic-{datetime.now():%Y%m%d-%H%M%S-%f}.db"
    backup.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database, timeout=30)) as connection:
        connection.execute('PRAGMA foreign_keys=ON')
        with closing(sqlite3.connect(backup)) as destination:
            connection.backup(destination)
        with connection:
            deck = connection.execute('SELECT id FROM decks WHERE name=? AND is_builtin=0', [DECK_NAME]).fetchone()
            if deck:
                deck_id = deck[0]
            else:
                deck_id = connection.execute(
                    'INSERT INTO decks (name,description,is_builtin) VALUES (?,?,0)',
                    [DECK_NAME, '570 academic words from the Minnesota English Language Program PDF, with dictionary examples.']
                ).lastrowid
            added = 0
            for entry in entries:
                existing = connection.execute(
                    'SELECT id FROM cards WHERE deck_id=? AND lower(word)=?', [deck_id, entry['word']]).fetchone()
                definition_data = json.dumps(entry.get('definition_data'), ensure_ascii=False) if entry.get('definition_data') else None
                if existing:
                    # Keep notes, learning status, and review scheduling on reruns.
                    connection.execute(
                        'UPDATE cards SET definition_data=COALESCE(?,definition_data), '
                        'phonetic=COALESCE(NULLIF(?,\'\'),phonetic), '
                        'audio_url=COALESCE(NULLIF(?,\'\'),audio_url) WHERE id=?',
                        [definition_data, entry.get('phonetic', ''), entry.get('audio_url', ''), existing[0]])
                else:
                    card_id = connection.execute(
                        'INSERT INTO cards (word,deck_id,is_learning,definition_data,phonetic,audio_url,notes,register) '
                        'VALUES (?,?,1,?,?,?,?,?)',
                        [entry['word'], deck_id, definition_data, entry.get('phonetic', ''),
                         entry.get('audio_url', ''), entry['hint'], 'academic']).lastrowid
                    connection.execute('INSERT INTO srs_data (card_id) VALUES (?)', [card_id])
                    added += 1
    return {'deck_id': deck_id, 'added': added, 'backup': str(backup)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--fallback', action='store_true', help='Use the existing Cambridge adapter when the free API has no examples')
    parser.add_argument('--import-deck', action='store_true')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--database', type=Path, default=ROOT / 'words.db')
    args = parser.parse_args()
    entries = extract_words()
    print(f'Extracted {len(entries)} unique PDF words and definitions.', flush=True)
    if args.fetch:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(lookup, entry, args.fallback): entry['word'] for entry in entries}
            done = examples = 0
            for future in as_completed(futures):
                result = future.result()
                done += 1
                examples += has_example(result.get('payload'))
                if done % 25 == 0 or done == len(entries):
                    print(f'Dictionary lookups: {done}/{len(entries)}; examples: {examples}', flush=True)
    entries = build_payload(entries)
    write_json(OUTPUT, entries)
    missing = [entry['word'] for entry in entries if not entry['has_dictionary_example']]
    report = {'words': len(entries), 'with_examples': len(entries) - len(missing), 'missing_examples': missing}
    if args.import_deck:
        report.update(import_deck(entries, args.database))
    write_json(ROOT / 'data' / 'academic_import_report.json', report)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
