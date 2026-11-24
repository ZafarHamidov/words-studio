// Exercise the static edition in a real browser. Pass a Playwright module path and site URL.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = process.argv[2] ? require(path.resolve(process.argv[2])) : require('playwright');
const url = process.argv[3] || 'http://127.0.0.1:8765/_site/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('cards-left').textContent === '570');
    assert.equal(await page.evaluate(async () => (await Api.getDecks()).decks.find(deck => deck.id === 8).total_words), 570);
    assert.equal(await page.locator('.source-tab:not([data-source="freedict"])').count(), 0);
    await page.keyboard.press('Space');
    await page.locator('#review-buttons').waitFor({ state: 'visible' });
    assert.ok(await page.locator('.def-example').count() > 0);
    fs.mkdirSync(path.resolve('.tmp/deployment'), { recursive: true });
    await page.screenshot({ path: '.tmp/deployment/pages-desktop.png', fullPage: true });
    const firstId = await page.evaluate(() => SRS.current().id);
    await page.locator('[data-button="good"]').click();
    await page.waitForFunction(() => document.getElementById('session-correct').textContent === '1');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('cards-left').textContent === '569');
    const reviewed = await page.evaluate(async id => (await Api.exportProgress()).state.cards.find(card => card.id === id), firstId);
    assert.equal(reviewed.phase, 'learning');
    assert.equal(reviewed.steps_index, 1);
    assert.equal(reviewed.total_reviews, 1);

    // Separate tabs serialize edits through IndexedDB rather than overwriting progress.
    const other = await context.newPage();
    await other.goto(url);
    await other.waitForFunction(() => document.getElementById('cards-left').textContent === '569');
    await Promise.all([
      page.evaluate(() => Api.createDeck({ name: 'First tab' })),
      other.evaluate(() => Api.createDeck({ name: 'Second tab' })),
    ]);
    const names = await page.evaluate(async () => (await Api.getDecks()).decks.map(deck => deck.name));
    assert.ok(names.includes('First tab') && names.includes('Second tab'));
    await other.close();

    // Exercise real UI search and filters on a project subdirectory URL.
    await page.locator('#nav-decks').click();
    await page.locator('.deck-card').filter({ hasText: 'Academic Word List' }).click();
    await page.locator('#word-search').fill('widespread');
    await page.waitForFunction(() => document.querySelectorAll('#word-list .word-item').length === 1);
    assert.match(await page.locator('#word-list').innerText(), /widespread/);
    await page.locator('#btn-close-deck').click();
    await page.locator('#btn-settings').click();
    assert.ok(await page.locator('#btn-export-progress').isVisible());
    assert.match(await page.locator('#modal-settings').innerText(), /Progress stays in this browser/);
    await page.locator('[data-modal="modal-settings"]').click();

    const lifecycle = await page.evaluate(async () => {
      const deck = await Api.createDeck({ name: 'Test deck' });
      const card = await Api.createCard({ word: 'academic', deck_id: deck.id, notes: 'My note' });
      await Api.updateCard(card.id, { notes: 'Updated note' });
      const easy = await Api.reviewCard(card.id, 'easy');
      const hard = await Api.reviewCard(card.id, 'hard');
      const again = await Api.reviewCard(card.id, 'again');
      await Api.removeCardsFromLearning([card.id]);
      const archived = (await Api.getLearningWords({ deck_id: String(deck.id) })).total;
      await Api.addWordsToDeck(deck.id, ['academic']);
      const reset = (await Api.getDueCards({ deck_id: deck.id })).cards[0];
      const backup = await Api.exportProgress();
      await Api.deleteDeck(deck.id);
      await Api.importProgress(backup);
      const restored = (await Api.getDeckWords(deck.id, { all: 1 })).words[0];
      let rejected = false;
      try { await Api.importProgress({ format: 'words-studio-progress', version: 1, state: {} }); } catch { rejected = true; }
      return { easy, hard, again, archived, reset, restored, rejected };
    });
    assert.equal(lifecycle.easy.new_interval, 4);
    assert.equal(lifecycle.hard.new_interval, 5);
    assert.equal(lifecycle.again.new_phase, 'learning');
    assert.equal(lifecycle.archived, 0);
    assert.equal(lifecycle.reset.phase, 'new');
    assert.equal(lifecycle.reset.total_reviews, 0);
    assert.equal(lifecycle.restored.notes, 'Updated note');
    assert.equal(lifecycle.rejected, true);

    // Use one bundled lookup plus an actual cross-origin dictionary request.
    const lookup = await page.evaluate(async () => {
      const cached = await Api.lookupWord('abandon');
      const live = await Api.lookupWord('hello');
      return { cached: cached.meanings.length, live: live.meanings.length };
    });
    assert.ok(lookup.cached > 0 && lookup.live > 0);

    // A second browser/device starts with its own untouched progress.
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await mobile.newPage();
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(url);
    await phone.waitForFunction(() => document.getElementById('cards-left').textContent === '570');
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await phone.screenshot({ path: '.tmp/deployment/pages-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    await context.close(); await mobile.close();
    console.log('PASS: visible sentences, review persistence, concurrent tabs, filters, card CRUD, SRS transitions, backups, live dictionary, and mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
