import { test, expect } from '@playwright/test';
import { openTab } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'damage');
});

test('renders the default ship on load', async ({ page }) => {
  await expect(page.locator('#shipSelect')).toHaveValue('havock');
  await expect(page.locator('.dc-card')).toHaveCount(3);
  await expect(page.locator('#dcGroups')).toContainText('Ready Room');
});

test('switching ship re-renders the repair locations', async ({ page }) => {
  await page.selectOption('#shipSelect', 'takanami');
  await expect(page.locator('.dc-card')).toHaveCount(3);
  await expect(page.locator('#dcGroups')).toContainText('Medbay');
  await expect(page.locator('#dcGroups')).not.toContainText('Ready Room');

  await page.selectOption('#shipSelect', 'havock');
  await expect(page.locator('#dcGroups')).toContainText('Ready Room');
});

test('each ship lists the same three groups', async ({ page }) => {
  for (const ship of ['havock', 'takanami']) {
    await page.selectOption('#shipSelect', ship);
    await expect(page.locator('.dc-card h3')).toHaveText([
      'OCPs',
      'Crystals',
      'Destabilisation Conduits',
    ]);
    // Three OCPs, three crystals, five conduits.
    await expect(page.locator('.dc-row')).toHaveCount(11);
  }
});

test('the crystal charger note is shown for both ships', async ({ page }) => {
  for (const [ship, note] of [
    ['havock', 'Charger located in the Ready Room'],
    ['takanami', 'Charger located in Medbay'],
  ]) {
    await page.selectOption('#shipSelect', ship);
    await expect(page.locator('.dc-note')).toHaveText(note);
  }
});

/**
 * What the button does is call window.open with the right file; how the
 * browser then treats a PDF is not the app's business and is not consistent.
 * Full Chromium renders it in the popup, so the popup's URL becomes the PDF's.
 * The headless shell — which is what CI runs — has no PDF viewer, so it
 * downloads the file instead and the popup's URL stays empty forever.
 *
 * Recording the call keeps the assertion on the app's actual contract, and
 * covers the noopener that a URL check never could. That the files exist and
 * are served is the next test's job.
 */
test('the map button opens that ship\'s PDF', async ({ page }) => {
  await page.evaluate(() => {
    window.__openCalls = [];
    window.open = (url, target, features) => {
      window.__openCalls.push({ url, target, features });
      return null;
    };
  });

  for (const ship of ['havock', 'takanami']) {
    await page.selectOption('#shipSelect', ship);
    await page.click('#viewMapBtn');
  }

  const calls = await page.evaluate(() => window.__openCalls);
  expect(calls).toHaveLength(2);

  expect(decodeURIComponent(calls[0].url)).toContain('HAVOCK_SHIP_MAP.pdf');
  expect(decodeURIComponent(calls[1].url)).toContain('Takanami_Ship_Map.pdf');

  for (const call of calls) {
    expect(call.target).toBe('_blank');
    expect(call.features).toContain('noopener');
  }
});

test('the map PDFs are actually served', async ({ request }) => {
  for (const path of ['/ship-maps/HAVOCK_SHIP_MAP.pdf', '/ship-maps/Takanami_Ship_Map.pdf']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type']).toContain('pdf');
  }
});
