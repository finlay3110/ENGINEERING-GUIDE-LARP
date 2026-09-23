import { test, expect } from '@playwright/test';
import { openTab, pickRank } from './helpers.mjs';

// A representative sample across all four types present in the canon list,
// not the full 32 - the exhaustive count is asserted separately below.
const SAMPLE_OPERATIONS = [
  ['OPERATION TEDDER', 'Military'],
  ['OPERATION AMUNDSEN', 'Exploration'],
  ['OPERATION REDENTOR', 'Diplomacy'],
  ['OPERATION MOCKINGBIRD', 'Intrigue'],
  ['TERRA NOVAN DIPLOMATIC INCIDENT', 'Diplomacy'], // no "OPERATION" prefix
];

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('the datalist offers every canon operation, and only real suggestions', async ({ page }) => {
  const options = await page.locator('#operationNames option').evaluateAll(
    els => els.map(o => o.value)
  );
  expect(options).toHaveLength(32);
  expect(new Set(options).size).toBe(32); // no duplicates
  for (const [name] of SAMPLE_OPERATIONS) expect(options).toContain(name);
});

test.describe('recognising a canon operation', () => {
  for (const [name, type] of SAMPLE_OPERATIONS) {
    test(`${name} -> ${type}`, async ({ page }) => {
      await page.fill('#missionName', name);
      await expect(page.locator('#missionType')).toHaveValue(type);
      await expect(page.locator('#operationHint')).toBeVisible();
      await expect(page.locator('#operationHint')).toHaveClass(/is-matched/);
      await expect(page.locator('#operationHintText')).toContainText(type);
    });
  }

  test('matching is case-insensitive', async ({ page }) => {
    await page.fill('#missionName', 'operation tedder');
    await expect(page.locator('#missionType')).toHaveValue('Military');
  });

  test('surrounding whitespace does not prevent a match', async ({ page }) => {
    await page.fill('#missionName', '  OPERATION TEDDER  ');
    await expect(page.locator('#missionType')).toHaveValue('Military');
  });
});

test.describe('free text stays free text', () => {
  test('an unlisted mission name shows no hint and leaves type unset', async ({ page }) => {
    await page.fill('#missionName', 'Kestrel Relief');
    await expect(page.locator('#operationHint')).toBeHidden();
    await expect(page.locator('#missionType')).toHaveValue('');
  });

  test('a near-miss of a canon name is treated as free text, not fuzzy-matched', async ({ page }) => {
    await page.fill('#missionName', 'OPERATION TEDDERS');
    await expect(page.locator('#operationHint')).toBeHidden();
    await expect(page.locator('#missionType')).toHaveValue('');
  });

  test('an empty mission name shows no hint', async ({ page }) => {
    await page.fill('#missionName', 'OPERATION TEDDER');
    await expect(page.locator('#operationHint')).toBeVisible();
    await page.fill('#missionName', '');
    await expect(page.locator('#operationHint')).toBeHidden();
  });
});

test.describe('a type already set is never silently overwritten', () => {
  test('typing a matching name does not change a manually-picked type', async ({ page }) => {
    await page.selectOption('#missionType', 'Diplomacy');
    await page.fill('#missionName', 'OPERATION TEDDER'); // canon type: Military
    await expect(page.locator('#missionType')).toHaveValue('Diplomacy');
  });

  test('the mismatch is shown, with a one-tap fix rather than a forced change', async ({ page }) => {
    await page.selectOption('#missionType', 'Diplomacy');
    await page.fill('#missionName', 'OPERATION TEDDER');

    await expect(page.locator('#operationHint')).toHaveClass(/is-mismatch/);
    await expect(page.locator('#operationHintText')).toContainText('canon type is Military');
    const apply = page.locator('#operationHintApply');
    await expect(apply).toBeVisible();
    await expect(apply).toHaveText('Use Military');

    await apply.click();
    await expect(page.locator('#missionType')).toHaveValue('Military');
    await expect(page.locator('#operationHint')).toHaveClass(/is-matched/);
    await expect(apply).toBeHidden();
  });

  test('picking a different canon name updates which type "Use X" offers', async ({ page }) => {
    await page.selectOption('#missionType', 'Diplomacy');
    await page.fill('#missionName', 'OPERATION AMUNDSEN'); // canon type: Exploration
    await expect(page.locator('#operationHintApply')).toHaveText('Use Exploration');
  });
});

test.describe('persistence', () => {
  test('a canon mission name and its derived type survive a reload', async ({ page }) => {
    await page.fill('#missionName', 'OPERATION MOCKINGBIRD');
    await expect(page.locator('#missionType')).toHaveValue('Intrigue');

    await page.reload();

    await expect(page.locator('#missionName')).toHaveValue('OPERATION MOCKINGBIRD');
    await expect(page.locator('#missionType')).toHaveValue('Intrigue');
    await expect(page.locator('#operationHint')).toBeVisible();
  });

  test('the derived type reaches the Action Log summary and JSON export', async ({ page }) => {
    await page.fill('#opName', 'Fin');
    await pickRank(page, 'Lieutenant');
    await page.fill('#missionName', 'OPERATION CLAYMORE');
    await openTab(page, 'log');

    await expect(page.locator('#logSummary')).toContainText('OPERATION CLAYMORE');
    await expect(page.locator('#logSummary')).toContainText('Military');

    const wait = page.waitForEvent('download');
    await page.click('#exportJsonBtn');
    const file = await wait;
    const fs = await import('node:fs');
    const data = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
    expect(data.mission.name).toBe('OPERATION CLAYMORE');
    expect(data.mission.type).toBe('Military');
  });

  test('New mission clears the name, type and hint together', async ({ page }) => {
    await page.fill('#missionName', 'OPERATION TEDDER');
    await expect(page.locator('#operationHint')).toBeVisible();

    await page.click('#newMissionBtn'); // no entries logged yet, so no confirm dialog

    await expect(page.locator('#missionName')).toHaveValue('');
    await expect(page.locator('#missionType')).toHaveValue('');
    await expect(page.locator('#operationHint')).toBeHidden();
  });
});
