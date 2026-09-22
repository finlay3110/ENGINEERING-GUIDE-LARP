import { test, expect } from '@playwright/test';
import { openTab } from './helpers.mjs';

const RANKS = [
  'Cadet', 'Ensign', 'Sub Lt', 'Lieutenant', 'Lt Cmdr', 'Commander',
  'Captain', 'Commodore', 'Rear Admiral', 'Vice Admiral', 'Admiral',
  'Admiral of the Fleet',
];

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('offers exactly the twelve ranks, in order, plus "Not set"', async ({ page }) => {
  const options = await page.locator('#opRank option').evaluateAll(
    els => els.map(o => o.value)
  );
  expect(options).toEqual(['', ...RANKS]);
});

test('defaults to Not set', async ({ page }) => {
  await expect(page.locator('#opRank')).toHaveValue('');
});

test('a picked rank reaches the log summary and the export', async ({ page }) => {
  await page.fill('#opName', 'Fin');
  await page.selectOption('#opRank', 'Commander');
  await openTab(page, 'log');
  await expect(page.locator('#logSummary')).toContainText('Commander Fin');

  const wait = page.waitForEvent('download');
  await page.click('#exportJsonBtn');
  const file = await wait;
  const fs = await import('node:fs');
  const data = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  expect(data.operator).toMatchObject({ name: 'Fin', rank: 'Commander' });
});

test('a picked rank survives a reload', async ({ page }) => {
  await page.selectOption('#opRank', 'Sub Lt');
  await page.reload();
  await expect(page.locator('#opRank')).toHaveValue('Sub Lt');
});

// A select blanks any value it has no option for. A rank stored under the
// old free-text field, or any rank the list has since moved on from, must
// not silently vanish from the mission on the next visit.
test('keeps a stored rank that is not in the current list', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('ucn-mission-v1', JSON.stringify({
      operator: { name: 'Fin', rank: 'Lt' },
    }));
  });
  await page.reload();

  await expect(page.locator('#opRank')).toHaveValue('Lt');
  await openTab(page, 'log');
  await expect(page.locator('#logSummary')).toContainText('Lt Fin');
});
