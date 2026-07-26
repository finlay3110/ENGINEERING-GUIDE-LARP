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

test('the map button opens that ship\'s PDF', async ({ page, context }) => {
  for (const [ship, file] of [
    ['havock', 'HAVOCK_SHIP_MAP.pdf'],
    ['takanami', 'Takanami_Ship_Map.pdf'],
  ]) {
    await page.selectOption('#shipSelect', ship);
    const popup = context.waitForEvent('page');
    await page.click('#viewMapBtn');
    const opened = await popup;
    expect(decodeURIComponent(opened.url())).toContain(file);
    await opened.close();
  }
});

test('the map PDFs are actually served', async ({ request }) => {
  for (const path of ['/ship-maps/HAVOCK_SHIP_MAP.pdf', '/ship-maps/Takanami_Ship_Map.pdf']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type']).toContain('pdf');
  }
});
