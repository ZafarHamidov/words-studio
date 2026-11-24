"""Verify the real PDF and database import without touching the user's DB."""

from pathlib import Path
from contextlib import closing
import sqlite3
import json
import tempfile
import unittest
from unittest.mock import patch

from import_academic_words import build_payload, extract_words, has_example, import_deck, ROOT


class AcademicImportTests(unittest.TestCase):
    def test_complete_pdf_extraction(self):
        entries = extract_words()
        self.assertEqual(len(entries), 570)
        self.assertEqual(len({entry['word'] for entry in entries}), 570)
        self.assertEqual(entries[0]['word'], 'abandon')
        self.assertEqual(entries[-1]['word'], 'widespread')
        self.assertTrue(all(entry['hint'] for entry in entries))
        self.assertIn('so-called', {entry['word'] for entry in entries})
        self.assertEqual(sum(entry['pdf_page'] == 14 for entry in entries), 37)

    def test_import_preserves_existing_cards_and_reviews(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / 'test.db'
            with closing(sqlite3.connect(ROOT / 'words.db')) as source, closing(sqlite3.connect(database)) as copy:
                source.backup(copy)
            with closing(sqlite3.connect(database)) as connection:
                original_cards = connection.execute('SELECT * FROM cards ORDER BY id').fetchall()
                original_srs = connection.execute('SELECT * FROM srs_data ORDER BY card_id').fetchall()
                original_reviews = connection.execute('SELECT * FROM review_log ORDER BY id').fetchall()
            entries = extract_words()
            try:
                first = import_deck(entries, database)
                with closing(sqlite3.connect(database)) as connection, connection:
                    self.assertEqual(connection.execute('SELECT COUNT(*) FROM cards WHERE deck_id=?', [first['deck_id']]).fetchone()[0], 570)
                    card_id = connection.execute('SELECT id FROM cards WHERE deck_id=? LIMIT 1', [first['deck_id']]).fetchone()[0]
                    connection.execute("UPDATE srs_data SET phase='review', total_reviews=7, interval=30 WHERE card_id=?", [card_id])
                    connection.execute("UPDATE cards SET notes='Personal note', is_learning=0 WHERE id=?", [card_id])
                second = import_deck(entries, database)
                self.assertEqual(second['added'], 0)
                self.assertEqual(second['deck_id'], first['deck_id'])
                with closing(sqlite3.connect(database)) as connection:
                    self.assertEqual(connection.execute('SELECT notes,is_learning FROM cards WHERE id=?', [card_id]).fetchone(), ('Personal note', 0))
                    self.assertEqual(connection.execute('SELECT phase,total_reviews,interval FROM srs_data WHERE card_id=?', [card_id]).fetchone(), ('review', 7, 30))
                    self.assertEqual(connection.execute('SELECT * FROM cards WHERE deck_id<>? ORDER BY id', [first['deck_id']]).fetchall(), original_cards)
                    self.assertEqual(connection.execute('SELECT * FROM srs_data WHERE card_id IN (SELECT id FROM cards WHERE deck_id<>?) ORDER BY card_id', [first['deck_id']]).fetchall(), original_srs)
                    self.assertEqual(connection.execute('SELECT * FROM review_log ORDER BY id').fetchall(), original_reviews)
                    self.assertEqual(connection.execute('PRAGMA foreign_key_check').fetchall(), [])
            finally:
                for result in (locals().get('first'), locals().get('second')):
                    if result:
                        Path(result['backup']).unlink(missing_ok=True)

    def test_complete_example_is_visible_and_keeps_its_definition(self):
        payload = {'source': 'freedict', 'meanings': [{'partOfSpeech': 'noun', 'definitions': [
            {'definition': 'A place.', 'example': ''},
            {'definition': 'A printed supplement.', 'example': 'a short appendix'},
            {'definition': 'Supplementary material at the end of a book.',
             'example': 'The book has an appendix with useful tables.'},
        ]}]}
        self.assertTrue(has_example(payload))
        self.assertFalse(has_example({'meanings': [{'definitions': [{'example': 'a short appendix'}]}]}))
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            (cache / 'appendix.json').write_text(json.dumps({'payload': payload}), encoding='utf-8')
            with patch('import_academic_words.CACHE', cache):
                entries = build_payload([{'word': 'appendix', 'hint': 'supplementary material at the end of a book'}])
            definition = entries[0]['definition_data']['meanings'][0]['definitions'][0]
            self.assertEqual(definition['definition'], 'Supplementary material at the end of a book.')
            self.assertEqual(definition['example'], 'The book has an appendix with useful tables.')
            self.assertTrue(entries[0]['has_dictionary_example'])


if __name__ == '__main__':
    unittest.main()
