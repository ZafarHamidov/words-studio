"""Build the static GitHub Pages edition without publishing private study data.

Edit for Pages assets or public datasets. Run --export-progress to also create
a private browser-import backup of the local SQLite database outside the site.
"""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import shutil
import sqlite3
from contextlib import closing

ROOT = Path(__file__).resolve().parents[1]


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    (output / 'data').mkdir(exist_ok=True)
    for name in ('sat_words', 'freq_words', 'academic_words', 'cefr'):
        payload = json.loads((ROOT / 'data' / f'{name}.json').read_text(encoding='utf-8'))
        (output / 'data' / f'{name}.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    shutil.copytree(ROOT / 'static', output / 'static', dirs_exist_ok=True)
    shutil.copyfile(ROOT / 'static/js/pages-api.js', output / 'static/js/api.js')
    html = (ROOT / 'templates/index.html').read_text(encoding='utf-8').replace('="/static/', '="./static/')
    html = re.sub(r'\s*<button class="source-tab[^"\n]*" data-source="(?:wiktionary|cambridge|oxford)"[^>]*>.*?</button>', '', html)
    html = html.replace('Progress is saved on this server. Export a backup to keep it safe or move it to another version.',
                        'Progress stays in this browser on this device. Export a backup to keep it safe or move it to another device.')
    html = html.replace('<meta name="description"', '<meta name="words-studio-edition" content="github-pages">\n  <meta name="description"')
    html = html.replace('<div class="app-brand">', '<div class="app-brand" title="Progress is saved in this browser. Use Settings to export a backup.">')
    (output / 'index.html').write_text(html, encoding='utf-8')
    (output / '.nojekyll').touch()
    print(f'Built GitHub Pages site: {output}')


def export_progress(output):
    with closing(sqlite3.connect(ROOT / 'words.db')) as connection:
        connection.row_factory = sqlite3.Row
        decks = [dict(row) for row in connection.execute('SELECT * FROM decks')]
        cards = [dict(row) for row in connection.execute('SELECT c.*,s.ease_factor,s.interval,s.phase,s.steps_index,s.due_datetime,s.due_date,s.last_reviewed,s.total_reviews,s.correct_reviews,s.show_definition_first FROM cards c JOIN srs_data s ON s.card_id=c.id')]
        for card in cards:
            for key in ('definition_data', 'collocations'):
                card[key] = json.loads(card[key]) if card[key] else (None if key == 'definition_data' else [])
        reviews = [dict(row) for row in connection.execute('SELECT *,date(reviewed_at) AS date FROM review_log')]
        settings = {row['key']: row['value'] for row in connection.execute('SELECT * FROM settings')}
    state = {'version': 1, 'cards': cards, 'decks': decks, 'reviews': reviews, 'settings': settings,
             'nextCard': max((card['id'] for card in cards), default=0) + 1,
             'nextDeck': max((deck['id'] for deck in decks), default=8) + 1}
    backup = {'format': 'words-studio-progress', 'version': 1, 'exported_at': datetime.now().isoformat(), 'state': state}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(backup, ensure_ascii=False), encoding='utf-8')
    print(f'Exported private progress backup: {output} ({len(cards)} cards)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '_site')
    parser.add_argument('--export-progress', action='store_true')
    args = parser.parse_args()
    build(args.output.resolve())
    if args.export_progress:
        export_progress(ROOT / 'output/private/words-studio-progress.json')
