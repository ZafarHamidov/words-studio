"""Seed hosted decks and move progress between Flask and the browser edition.

Edit when backup format or first-start datasets change. Private backups stay
beside the persistent database and are never part of a container image.
"""
from contextlib import closing
from datetime import datetime
import json
from pathlib import Path
import sqlite3

CARD_FIELDS = ('id', 'word', 'phonetic', 'audio_url', 'deck_id', 'is_learning', 'definition_data', 'collocations', 'register', 'notes', 'created_at')
SRS_FIELDS = ('ease_factor', 'interval', 'phase', 'steps_index', 'due_datetime', 'due_date', 'last_reviewed', 'total_reviews', 'correct_reviews', 'show_definition_first')
DECK_FIELDS = ('id', 'name', 'description', 'is_builtin', 'created_at')


def seed_academic_deck(database, data_directory):
    path = Path(data_directory) / 'academic_words.json'
    if not path.exists():
        return
    with closing(sqlite3.connect(database)) as connection, connection:
        if connection.execute("SELECT 1 FROM settings WHERE key='academic_seed_v1'").fetchone():
            return
        name = 'Academic Word List (570 words)'
        existing = connection.execute('SELECT id FROM decks WHERE name=?', [name]).fetchone()
        if not existing:
            entries = json.loads(path.read_text(encoding='utf-8'))
            if len(entries) != 570:
                raise ValueError('Academic dataset must contain 570 words')
            deck_id = connection.execute(
                'INSERT INTO decks(name,description,is_builtin) VALUES (?,?,0)',
                [name, '570 academic words with dictionary example sentences']).lastrowid
            for entry in entries:
                card_id = connection.execute(
                    'INSERT INTO cards(word,deck_id,definition_data,phonetic,audio_url,notes,register) VALUES (?,?,?,?,?,?,?)',
                    [entry['word'], deck_id, json.dumps(entry.get('definition_data'), ensure_ascii=False),
                     entry.get('phonetic', ''), entry.get('audio_url', ''), entry['hint'], 'academic']).lastrowid
                connection.execute('INSERT INTO srs_data(card_id) VALUES (?)', [card_id])
        connection.execute("INSERT INTO settings(key,value) VALUES ('academic_seed_v1','true')")


def export_progress(connection):
    decks = [dict(row) for row in connection.execute('SELECT * FROM decks ORDER BY id')]
    cards = [dict(row) for row in connection.execute(
        'SELECT c.*,s.ease_factor,s.interval,s.phase,s.steps_index,s.due_datetime,s.due_date,'
        's.last_reviewed,s.total_reviews,s.correct_reviews,s.show_definition_first '
        'FROM cards c JOIN srs_data s ON s.card_id=c.id ORDER BY c.id')]
    for card in cards:
        for field in ('definition_data', 'collocations'):
            card[field] = json.loads(card[field]) if card[field] else (None if field == 'definition_data' else [])
    return {'format': 'words-studio-progress', 'version': 1, 'exported_at': datetime.now().isoformat(), 'state': {
        'version': 1, 'decks': decks, 'cards': cards,
        'reviews': [dict(row) for row in connection.execute('SELECT *,date(reviewed_at) AS date FROM review_log ORDER BY id')],
        'settings': {row['key']: row['value'] for row in connection.execute("SELECT * FROM settings WHERE key<>'academic_seed_v1'")},
        'nextCard': max((card['id'] for card in cards), default=0) + 1,
        'nextDeck': max((deck['id'] for deck in decks), default=0) + 1,
    }}


def validate_backup(backup):
    if not isinstance(backup, dict) or backup.get('format') != 'words-studio-progress' or backup.get('version') != 1:
        raise ValueError('Invalid Words Studio backup')
    state = backup.get('state')
    if not isinstance(state, dict) or not all(isinstance(state.get(key), list) for key in ('decks', 'cards', 'reviews')) or not isinstance(state.get('settings'), dict):
        raise ValueError('Backup is missing study data')
    if len(state['cards']) > 50000 or len(state['decks']) > 1000 or len(state['reviews']) > 500000:
        raise ValueError('Backup is too large')
    deck_ids, card_ids, words = set(), set(), set()
    for deck in state['decks']:
        if not isinstance(deck, dict) or type(deck.get('id')) is not int or deck['id'] < 1 or deck['id'] in deck_ids or not isinstance(deck.get('name'), str) or not deck['name'].strip():
            raise ValueError('Invalid deck in backup')
        if deck.get('is_builtin') and deck['id'] not in (1, 2):
            raise ValueError('Unknown built-in deck')
        if deck.get('description') is not None and not isinstance(deck['description'], str):
            raise ValueError('Invalid deck description')
        deck_ids.add(deck['id'])
    if not {1, 2}.issubset(deck_ids):
        raise ValueError('Backup is missing built-in decks')
    for card in state['cards']:
        if not isinstance(card, dict) or type(card.get('id')) is not int or card['id'] < 1 or card['id'] in card_ids or card.get('deck_id') not in deck_ids or not isinstance(card.get('word'), str) or not card['word'].strip():
            raise ValueError('Invalid card in backup')
        key = (card['deck_id'], card['word'].strip().lower())
        if key in words:
            raise ValueError('Backup contains duplicate words in a deck')
        if card.get('phase') not in ('new', 'learning', 'review') or card.get('steps_index') not in (0, 1):
            raise ValueError('Invalid review scheduling')
        for field in ('ease_factor', 'interval', 'total_reviews', 'correct_reviews'):
            value = card.get(field)
            if not isinstance(value, (int, float)) or not 0 <= value <= 100000000:
                raise ValueError('Invalid review scheduling')
        for field in ('due_date', 'due_datetime'):
            try:
                datetime.fromisoformat(card[field])
            except (KeyError, TypeError, ValueError):
                raise ValueError('Invalid review due date') from None
        if card.get('definition_data') is not None and not isinstance(card['definition_data'], dict):
            raise ValueError('Invalid card definitions')
        if not isinstance(card.get('collocations', []), list):
            raise ValueError('Invalid card collocations')
        if card.get('is_learning', 1) not in (0, 1, False, True):
            raise ValueError('Invalid learning status')
        for field in ('phonetic', 'audio_url', 'register', 'notes', 'created_at', 'last_reviewed'):
            if card.get(field) is not None and not isinstance(card[field], str):
                raise ValueError('Invalid card text')
        card_ids.add(card['id'])
        words.add(key)
    for review in state['reviews']:
        if not isinstance(review, dict) or review.get('button') not in ('again', 'hard', 'good', 'easy'):
            raise ValueError('Invalid review history')
        try:
            datetime.fromisoformat(review.get('reviewed_at') or review['date'])
        except (KeyError, TypeError, ValueError):
            raise ValueError('Invalid review date') from None
    return state


def insert_record(connection, table, fields, record):
    keys = [key for key in fields if key in record]
    placeholders = ','.join('?' for _ in keys)
    connection.execute(f"INSERT INTO {table} ({','.join(keys)}) VALUES ({placeholders})", [record[key] for key in keys])


def restore_progress(connection, backup, database):
    state = validate_backup(backup)
    path = Path(database).parent / 'backups' / f'progress-before-import-{datetime.now():%Y%m%d-%H%M%S-%f}.sqlite3'
    path.parent.mkdir(parents=True, exist_ok=True)
    # Take a consistent snapshot before opening the restore transaction.
    with closing(sqlite3.connect(path)) as destination:
        connection.backup(destination)
    with connection:
        for table in ('review_log', 'srs_data', 'cards', 'decks', 'settings'):
            connection.execute(f'DELETE FROM {table}')
        for deck in state['decks']:
            insert_record(connection, 'decks', DECK_FIELDS, deck)
        for source in state['cards']:
            card = dict(source)
            for field in ('definition_data', 'collocations'):
                card[field] = json.dumps(card.get(field), ensure_ascii=False) if card.get(field) is not None else None
            insert_record(connection, 'cards', CARD_FIELDS, card)
            insert_record(connection, 'srs_data', ('card_id',) + SRS_FIELDS, {**card, 'card_id': card['id']})
        card_ids = {card['id'] for card in state['cards']}
        for review in state['reviews']:
            insert_record(connection, 'review_log', ('card_id', 'button', 'reviewed_at', 'interval_before', 'interval_after'), {
                **review, 'card_id': review.get('card_id') if review.get('card_id') in card_ids else None,
                'reviewed_at': review.get('reviewed_at') or review['date']})
        for key, value in state['settings'].items():
            connection.execute('INSERT INTO settings(key,value) VALUES (?,?)', [str(key), str(value)])
        connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('academic_seed_v1','true')")
    return {'imported': len(state['cards']), 'reviews': len(state['reviews'])}
