# Words Studio

English vocabulary flashcards with spaced repetition, SAT and common-word decks,
and all 570 academic words with dictionary example sentences.

## GitHub Pages edition

The Pages edition runs entirely in the browser and saves cards, notes, and review
history in IndexedDB. Each browser/device has its own progress. Use **Settings →
Export Progress / Import Progress** to back it up or transfer it. Clearing site
data removes progress unless you have a backup.

New dictionary lookups use the free [Dictionary API](https://dictionaryapi.dev/).
The academic deck includes previously fetched examples from that API and
Cambridge Dictionary, with source URLs stored alongside the definitions. Server
dictionary tabs are available in the Flask edition.

Build the site with Python (no build dependencies required):

```sh
python scripts/build_pages.py
python -m http.server 8000
```

Open `http://localhost:8000/_site/`. Pushes to `main` publish `_site` through the
GitHub Pages workflow. Configure repository Pages settings to use GitHub Actions.

## Local Flask edition

```sh
python -m pip install -r requirements.txt
python app.py
```

The Flask edition stores progress in the local `words.db` database. To transfer
that progress to the Pages edition, run:

```sh
python scripts/build_pages.py --export-progress
```

Import `output/private/words-studio-progress.json` using the website's Settings.
The database, exported progress, backups, PDFs, and local credentials are excluded
from Git and from the published site.

## Browser verification

With Playwright installed, run a local static server and:

```sh
node scripts/test_pages.cjs /path/to/node_modules/playwright http://localhost:8000/_site/
```

The browser check covers persistence after reload, two simultaneous tabs,
card/deck editing, review scheduling, backups, dictionary lookup, and mobile layout.
