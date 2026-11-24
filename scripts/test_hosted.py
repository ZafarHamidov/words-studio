"""Verify hosted startup, authentication, seeding, and backup restore on a private test DB."""
import base64
from contextlib import closing
import importlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TEMPORARY = tempfile.TemporaryDirectory()
os.environ['DB_PATH'] = str(Path(TEMPORARY.name) / 'nested/study.sqlite3')
TEST_PASSWORD = secrets.token_urlsafe(24)
os.environ['ADMIN_PASSWORD'] = TEST_PASSWORD
import wsgi
import app as module
from server_storage import export_progress, seed_academic_deck
from werkzeug.test import Client
from werkzeug.wrappers import Response


class HostedTests(unittest.TestCase):
    def setUp(self):
        self.client = Client(wsgi.application, Response)
        self.headers = {'Authorization': 'Basic ' + base64.b64encode(('admin:' + TEST_PASSWORD).encode()).decode()}

    def test_password_protects_pages_and_data_but_allows_health(self):
        self.assertEqual(self.client.get('/api/health').json, {'status': 'ok'})
        for path in ('/', '/api/decks', '/api/backup', '/static/js/main.js'):
            self.assertEqual(self.client.get(path).status_code, 401)
        wrong = {'Authorization': 'Basic ' + base64.b64encode(b'admin:incorrect').decode()}
        self.assertEqual(self.client.get('/api/decks', headers=wrong).status_code, 401)
        self.assertEqual(self.client.get('/', headers=self.headers).status_code, 200)

    def test_seed_does_not_duplicate_or_reset_progress(self):
        decks = self.client.get('/api/decks', headers=self.headers).json['decks']
        academic = next(deck for deck in decks if deck['name'] == 'Academic Word List (570 words)')
        self.assertEqual(academic['total_words'], 570)
        card = self.client.get(f"/api/cards/due?deck_id={academic['id']}", headers=self.headers).json['cards'][0]
        self.assertTrue(any(d.get('example') for m in card['definition_data']['meanings'] for d in m['definitions'][:2]))
        self.client.post(f"/api/cards/{card['id']}/review", json={'button': 'good'}, headers=self.headers)
        seed_academic_deck(module.DATABASE, module.DATA_DIR)
        with closing(sqlite3.connect(module.DATABASE)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM cards').fetchone()[0], 570)
            self.assertEqual(db.execute('SELECT total_reviews FROM srs_data WHERE card_id=?', [card['id']]).fetchone()[0], 1)

    def test_backup_round_trip_and_failed_restore_preserve_database(self):
        original = self.client.get('/api/backup', headers=self.headers).json
        card_id = original['state']['cards'][0]['id']
        self.client.put(f'/api/cards/{card_id}', json={'notes': 'Temporary change'}, headers=self.headers)
        result = self.client.post('/api/backup/import', json=original, headers=self.headers)
        self.assertEqual(result.status_code, 200, result.text)
        restored = self.client.get('/api/backup', headers=self.headers).json
        self.assertEqual(restored['state']['cards'], original['state']['cards'])
        self.assertEqual(restored['state']['reviews'], original['state']['reviews'])
        invalid = json.loads(json.dumps(original))
        invalid['state']['cards'][0]['due_datetime'] = 'invalid'
        self.assertEqual(self.client.post('/api/backup/import', json=invalid, headers=self.headers).status_code, 400)
        after = self.client.get('/api/backup', headers=self.headers).json
        self.assertEqual(after['state']['cards'], original['state']['cards'])
        self.assertTrue(list((Path(module.DATABASE).parent / 'backups').glob('*.sqlite3')))
        with closing(sqlite3.connect(module.DATABASE)) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        TEMPORARY.cleanup()
