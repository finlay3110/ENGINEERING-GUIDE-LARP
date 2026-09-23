import { test, expect } from '@playwright/test';
import { openTab, pickRank } from './helpers.mjs';

const RANKS = [
  'Cadet', 'Ensign', 'Sub Lt', 'Lieutenant', 'Lt Cmdr', 'Commander',
  'Captain', 'Commodore', 'Rear Admiral', 'Vice Admiral', 'Admiral',
  'Admiral of the Fleet',
];

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('defaults to blank, and the list is closed until the field is used', async ({ page }) => {
  await expect(page.locator('#opRank')).toHaveValue('');
  await expect(page.locator('#opRankListbox')).toBeHidden();
});

test('focusing the field opens the full list of twelve ranks, in order', async ({ page }) => {
  await page.click('#opRank');
  await expect(page.locator('#opRankListbox')).toBeVisible();
  const options = await page.locator('#opRankListbox .combobox-option').evaluateAll(
    els => els.map(o => o.textContent)
  );
  expect(options).toEqual(RANKS);
});

test('typing filters the list down to matching ranks', async ({ page }) => {
  await page.fill('#opRank', 'lt'); // case-insensitive, and a substring match
  const options = await page.locator('#opRankListbox .combobox-option').evaluateAll(
    els => els.map(o => o.textContent)
  );
  expect(options).toEqual(['Sub Lt', 'Lt Cmdr']);
});

test('a search with no matches shows an empty state, not a stale list', async ({ page }) => {
  await page.fill('#opRank', 'zzz');
  await expect(page.locator('#opRankListbox')).toContainText('No matching rank');
  await expect(page.locator('.combobox-option')).toHaveCount(0);
});

test('clicking a rank picks it and closes the list', async ({ page }) => {
  await pickRank(page, 'Commander');
  await expect(page.locator('#opRank')).toHaveValue('Commander');
  await expect(page.locator('#opRankListbox')).toBeHidden();
});

test('arrow keys move through the list and Enter commits the highlighted rank', async ({ page }) => {
  await page.click('#opRank');
  await page.keyboard.press('ArrowDown'); // off Cadet, onto Ensign
  await page.keyboard.press('ArrowDown'); // onto Sub Lt
  await page.keyboard.press('Enter');
  await expect(page.locator('#opRank')).toHaveValue('Sub Lt');
  await expect(page.locator('#opRankListbox')).toBeHidden();
});

test('Escape closes the list and undoes an uncommitted edit without blurring the field', async ({ page }) => {
  await pickRank(page, 'Captain');
  await page.locator('#opRank').fill('Comm');
  await page.keyboard.press('Escape');
  await expect(page.locator('#opRankListbox')).toBeHidden();
  await expect(page.locator('#opRank')).toHaveValue('Captain');
  await expect(page.locator('#opRank')).toBeFocused();
});

test.describe('rank is locked to the list', () => {
  test('typing something that matches no rank reverts on blur, rather than keeping free text', async ({ page }) => {
    await page.fill('#opRank', 'Space Marine');
    await page.locator('#opName').click(); // blur
    await expect(page.locator('#opRank')).toHaveValue('');
  });

  test('an unfinished, partial rank reverts to the previously picked one on blur', async ({ page }) => {
    await pickRank(page, 'Lieutenant');
    await page.fill('#opRank', 'Comm');
    await page.locator('#opName').click(); // blur
    await expect(page.locator('#opRank')).toHaveValue('Lieutenant');
  });

  test('typing a rank\'s exact text without clicking it still commits it on blur', async ({ page }) => {
    await page.fill('#opRank', 'Commodore');
    await page.locator('#opName').click(); // blur
    await expect(page.locator('#opRank')).toHaveValue('Commodore');
  });
});

test('a picked rank reaches the log summary and the export', async ({ page }) => {
  await page.fill('#opName', 'Fin');
  await pickRank(page, 'Commander');
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
  await pickRank(page, 'Sub Lt');
  await page.reload();
  await expect(page.locator('#opRank')).toHaveValue('Sub Lt');
});

// A search box that reverts anything not on the list would also wipe out a
// rank saved under the old free-text field, or one a future list moves on
// from. That value has to survive being loaded even though typing it fresh
// no longer would.
test.describe('a legacy rank not in the current list', () => {
  async function seedLegacyRank(page) {
    await page.evaluate(() => {
      localStorage.setItem('ucn-mission-v1', JSON.stringify({
        operator: { name: 'Fin', rank: 'Lt' },
      }));
    });
    await page.reload();
  }

  test('is kept on load rather than blanked', async ({ page }) => {
    await seedLegacyRank(page);
    await expect(page.locator('#opRank')).toHaveValue('Lt');
    await openTab(page, 'log');
    await expect(page.locator('#logSummary')).toContainText('Lt Fin');
  });

  test('survives an untouched blur', async ({ page }) => {
    await seedLegacyRank(page);
    await page.click('#opRank');
    await page.locator('#opName').click(); // blur without changing anything
    await expect(page.locator('#opRank')).toHaveValue('Lt');
  });

  test('is replaced once a real rank is picked', async ({ page }) => {
    await seedLegacyRank(page);
    await pickRank(page, 'Ensign');
    await expect(page.locator('#opRank')).toHaveValue('Ensign');
  });
});
