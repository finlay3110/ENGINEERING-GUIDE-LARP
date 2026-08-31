import { test, expect } from '@playwright/test';
import { openTab, tabHidden, availableTabs } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('setup is the first tab and opens by default', async ({ page }) => {
  await expect(page.locator('#panel-setup')).toBeVisible();
  const first = await page.evaluate(
    () => document.querySelector('.tabs [role="tab"]').dataset.tab
  );
  expect(first).toBe('setup');
});

test('mission details reach the log summary', async ({ page }) => {
  await page.fill('#opName', 'Fin');
  await page.fill('#opRank', 'Lt');
  await page.fill('#missionName', 'Kestrel Relief');
  await page.fill('#missionType', 'Patrol');
  await page.selectOption('#setupShip', 'takanami');

  await openTab(page, 'log');
  const summary = page.locator('#logSummary');
  await expect(summary).toContainText('Lt Fin');
  await expect(summary).toContainText('Kestrel Relief');
  await expect(summary).toContainText('Patrol');
  await expect(summary).toContainText('UCS Takanami');
});

test('the Now button fills the start time', async ({ page }) => {
  await expect(page.locator('#missionStart')).toHaveValue('');
  await page.click('#nowBtn');
  await expect(page.locator('#missionStart')).toHaveValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
});

test.describe('module checkboxes', () => {
  test('unticking Power Management hides its three tabs', async ({ page }) => {
    for (const t of ['power', 'thermal', 'warp']) {
      expect(await tabHidden(page, t), t).toBe(false);
    }
    await page.uncheck('#modPower');
    for (const t of ['power', 'thermal', 'warp']) {
      expect(await tabHidden(page, t), t).toBe(true);
    }
    // Damage control is a separate module and must be unaffected.
    expect(await tabHidden(page, 'damage')).toBe(false);

    await page.check('#modPower');
    expect(await tabHidden(page, 'power')).toBe(false);
  });

  test('unticking Damage Control hides its tab and the repair buttons', async ({ page }) => {
    await page.uncheck('#modDamage');
    expect(await tabHidden(page, 'damage')).toBe(true);

    await openTab(page, 'log');
    await expect(page.locator('#damageActions')).toBeHidden();
    await expect(page.locator('#damageDisabledNote')).toBeVisible();
    // The spares counter only means something alongside damage control.
    await expect(page.locator('#spareStat')).toBeHidden();

    await openTab(page, 'setup');
    await page.check('#modDamage');
    await openTab(page, 'log');
    await expect(page.locator('#damageActions')).toBeVisible();
  });

  test('setup and log stay reachable with every module off', async ({ page }) => {
    await page.uncheck('#modPower');
    await page.uncheck('#modDamage');
    expect(await availableTabs(page)).toEqual(['setup', 'log']);
  });

  // Hiding the tab you are standing on would otherwise strand the page on a
  // panel with no tab to return to.
  test('hiding the open tab falls back to setup', async ({ page }) => {
    await openTab(page, 'warp');
    await expect(page.locator('#panel-warp')).toBeVisible();

    await openTab(page, 'setup');
    await page.uncheck('#modPower');
    await expect(page.locator('#panel-setup')).toBeVisible();
    await expect(page.locator('#panel-warp')).toBeHidden();
  });
});

test('the ship picker is shared with Damage Control', async ({ page }) => {
  await page.selectOption('#setupShip', 'takanami');
  await openTab(page, 'damage');
  await expect(page.locator('#shipSelect')).toHaveValue('takanami');
  await expect(page.locator('#dcGroups')).toContainText('Medbay');

  // ...and back the other way.
  await page.selectOption('#shipSelect', 'havock');
  await openTab(page, 'setup');
  await expect(page.locator('#setupShip')).toHaveValue('havock');
});

test('setup survives a reload', async ({ page }) => {
  await page.fill('#opName', 'Fin');
  await page.fill('#missionName', 'Kestrel Relief');
  await page.selectOption('#setupShip', 'takanami');
  await page.uncheck('#modPower');

  await page.reload();

  await expect(page.locator('#opName')).toHaveValue('Fin');
  await expect(page.locator('#missionName')).toHaveValue('Kestrel Relief');
  await expect(page.locator('#setupShip')).toHaveValue('takanami');
  await expect(page.locator('#modPower')).not.toBeChecked();
  expect(await tabHidden(page, 'warp')).toBe(true);
});

test('clearing mission data resets everything', async ({ page }) => {
  await page.fill('#opName', 'Fin');
  await openTab(page, 'log');
  await page.click('#manualRepairBtn');
  await page.click('[data-kind="reactor"]');
  await expect(page.locator('#statReactor')).toHaveText('1');

  await openTab(page, 'setup');
  page.once('dialog', d => {
    expect(d.message()).toContain('1 logged action');
    d.accept();
  });
  await page.click('#clearSessionBtn');

  await expect(page.locator('#opName')).toHaveValue('');
  await openTab(page, 'log');
  await expect(page.locator('#statReactor')).toHaveText('0');
  await expect(page.locator('#statSpares')).toHaveText('5');
});

test('cancelling the clear confirmation keeps the data', async ({ page }) => {
  await page.fill('#opName', 'Fin');
  page.once('dialog', d => d.dismiss());
  await page.click('#clearSessionBtn');
  await expect(page.locator('#opName')).toHaveValue('Fin');
});
