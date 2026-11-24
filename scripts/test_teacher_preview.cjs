// Verify the standalone classroom design, its sample-data interactions, and responsive layout.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(path.resolve(process.argv[2] || '.tmp/deployment/browser-check/node_modules/playwright'));
const url = process.argv[3] || 'http://127.0.0.1:8765/_site/teacher-preview/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    const errors = [], failedAssets = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().startsWith(url) && response.status() >= 400) failedAssets.push(response.url()); });
    await page.goto(url);
    await page.locator('#student-rows tr').first().waitFor();
    assert.equal(await page.locator('#student-rows tr').count(), 6);
    assert.match(await page.locator('#table-summary').innerText(), /of 18 students/);
    assert.match(await page.locator('.metric-number').nth(1).innerText(), /4,242/);
    const vocabulary = new Set(await page.evaluate(async () => (await (await fetch('./academic_words.json')).json()).map(entry => entry.word)));
    for (const word of await page.locator('[data-word]').evaluateAll(elements => elements.map(element => element.dataset.word))) assert.ok(vocabulary.has(word), word);
    assert.equal(await page.locator('[data-action="new-assignment"]').count(), 0);
    await page.screenshot({ path: '.tmp/deployment/teacher-overview-desktop.png', fullPage: true });

    await page.locator('#student-search').fill('Ella');
    assert.equal(await page.locator('#student-rows tr').count(), 1);
    assert.match(await page.locator('#student-rows').innerText(), /Ella Young/);
    await page.locator('#student-search').fill('not-a-student');
    assert.match(await page.locator('#student-rows').innerText(), /No students match/);
    await page.locator('#student-search').fill('');
    await page.locator('[data-filter="attention"]').click();
    assert.equal(await page.locator('#student-rows tr').count(), 5);
    assert.match(await page.locator('#table-summary').innerText(), /of 5 students/);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#student-rows tr[data-student="1"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('#dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#dialog').innerText(), /Maya Chen/);
    assert.match(await page.locator('#dialog').innerText(), /318/);
    await page.screenshot({ path: '.tmp/deployment/teacher-student-detail.png', fullPage: true });
    await page.locator('[data-student-preview="1"]').click();
    assert.match(await page.locator('h1').innerText(), /Maya/);
    assert.match(await page.locator('#navigation').innerText(), /My learning/);
    assert.equal(await page.locator('#navigation [data-nav="students"]').count(), 0);
    await page.screenshot({ path: '.tmp/deployment/teacher-student-view.png', fullPage: true });
    await page.locator('[data-action="practice"]').first().click();
    for (let i = 0; i < 5; i++) {
      await page.locator('[data-action="reveal"]').click();
      assert.ok(await page.locator('#dialog .word-definition').isVisible());
      await page.locator('[data-review="remembered"]').click();
    }
    assert.match(await page.locator('#dialog').innerText(), /323 of 570 words/);
    await page.locator('[data-action="practice-teacher"]').click();
    assert.match(await page.locator('#dialog .detail-metrics').innerText(), /323/);
    await page.keyboard.press('Escape');
    await page.locator('[data-filter="all"]').click();
    assert.match(await page.locator('#student-rows tr[data-student="1"]').innerText(), /323/);
    await page.reload();
    await page.locator('#student-rows tr').first().waitFor();
    assert.match(await page.locator('#student-rows tr[data-student="1"]').innerText(), /323/);

    await page.locator('[data-nav="deck"]').click();
    await page.locator('#deck-search').waitFor();
    assert.match(await page.locator('#deck-count').innerText(), /570 words/);
    assert.equal(await page.locator('.word-card').count(), 18);
    await page.locator('#more-words').click();
    assert.equal(await page.locator('.word-card').count(), 36);
    await page.locator('#deck-search').fill('ambiguous');
    assert.equal(await page.locator('.word-card').count(), 1);
    await page.locator('.word-card').click();
    assert.match(await page.locator('#dialog').innerText(), /ambiguous/);
    assert.ok(await page.locator('#dialog .example-sentence').isVisible());
    await page.keyboard.press('Escape');

    await page.locator('[data-nav="assignments"]').click();
    await page.locator('[data-action="new-assignment"]').click();
    await page.locator('#assignment-form input[name="title"]').fill('Next week’s vocabulary');
    await page.locator('#assignment-form input[name="start"]').fill('560');
    await page.locator('[form="assignment-form"]').click();
    assert.ok(await page.locator('#assignment-error').isVisible());
    await page.locator('#assignment-form input[name="start"]').fill('236');
    await page.locator('[form="assignment-form"]').click();
    assert.equal(await page.locator('.assignment-card').count(), 3);
    assert.match(await page.locator('.assignment-card').first().innerText(), /Next week’s vocabulary/);
    await page.locator('.assignment-card').first().locator('[data-assignment]').click();
    assert.equal(await page.locator('#dialog .word-chip').count(), 35);
    await page.keyboard.press('Escape');

    await page.locator('[data-nav="reports"]').click();
    assert.equal(await page.locator('.heatmap-cell').count(), 18 * 14);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const report = fs.readFileSync(downloadPath, 'utf8');
    assert.equal(report.split('\r\n').length, 19);
    assert.match(report, /"Maya Chen","323"/);

    await page.locator('[data-nav="overview"]').click();
    await page.locator('#period-select').selectOption('month');
    assert.match(await page.locator('.chart-insight').innerText(), /this month/);
    await page.locator('[data-action="invite"]').click();
    assert.match(await page.locator('#dialog').innerText(), /design preview/i);
    await page.keyboard.press('Escape');
    await page.locator('#references-button').click();
    assert.equal(await page.locator('#dialog .reference-list a').count(), 3);
    await page.keyboard.press('Escape');

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await mobile.newPage();
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(url);
    await phone.locator('#student-rows tr').first().waitFor();
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await phone.screenshot({ path: '.tmp/deployment/teacher-overview-mobile.png', fullPage: true });
    await phone.locator('#mobile-menu').click();
    await phone.locator('[data-nav="deck"]').click();
    assert.match(await phone.locator('#deck-count').innerText(), /570 words/);
    await phone.locator('#mobile-menu').click();
    await phone.locator('#modal-backdrop').click({ position: { x: 350, y: 300 } });
    assert.equal(await phone.locator('#mobile-menu').getAttribute('aria-expanded'), 'false');
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const studentPage = await mobile.newPage();
    await studentPage.goto(url + '?view=student');
    await studentPage.locator('.student-hero').waitFor();
    assert.equal(await studentPage.locator('#student-role').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    assert.deepEqual(failedAssets, []);
    await context.close(); await mobile.close();
    console.log('PASS: teacher roster, search, attention filter, student detail, practice tracking, real 570-word deck, assignments, CSV, reports, persistence, and mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
