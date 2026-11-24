# Words Studio

English vocabulary flashcards with spaced repetition, SAT and common-word decks,
and all 570 academic words with dictionary example sentences.

## TLF PaaS edition

`docker-compose.yml` uses one public `web` service on internal port **8080**.
The image runs as non-root user `app` and serves Flask through Gunicorn. It follows
the [student deployment guide](https://deploy.tlfedu.tech/guides/students/deploys.md)
and [Docker contract](https://deploy.tlfedu.tech/guides/docker/agents.md).

After the GitHub account joins `leaders-tech`, transfer this repository to that
organization and push the latest commit. In the project's **Secrets** page at
<https://deploy.tlfedu.tech/my/projects>, set `ADMIN_PASSWORD` to a unique password
of at least 12 characters, then select **Redeploy now**. Sign in to the published
app as **admin** using that password. Never commit the password.

SQLite lives at `/data/app.sqlite3` in the `sqlite_data` named volume, so progress
is shared across devices and survives container replacement. The first start
loads all 570 academic cards with examples. Use **Settings → Import Progress** to
restore a browser or local Flask backup; the server first saves a recovery copy
under `/data/backups`. **Export Progress** downloads the same portable format.

`GET /api/health` is a public health check; the app and study APIs require login.
The **Verify hosted container** workflow builds the actual Linux image, checks
its non-root user and health, and verifies that saved data survives replacing
the container. Local application checks run with `python scripts/test_hosted.py`.
Local Docker needs `DB_PATH=/data/app.sqlite3` and `ADMIN_PASSWORD` passed as
ordinary runtime environment variables; TLF PaaS supplies them from its settings
and secrets automatically.

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
