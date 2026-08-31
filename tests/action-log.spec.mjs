import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openTab } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'log');
});

/** Walk the repair picker down to a target and start the repair. */
async function startRepair(page, kind, index = 0) {
  await page.click('#manualRepairBtn');
  await page.click(`[data-kind="${kind}"]`);
  if (kind !== 'reactor') {
    await page.click(`#repairDialogBody .choice >> nth=${index}`);
  }
}

test('the log starts empty', async ({ page }) => {
  await expect(page.locator('#activeList')).toContainText('Nothing in progress');
  await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
  for (const id of ['#statOcp', '#statCrystal', '#statConduit', '#statSwap']) {
    await expect(page.locator(id)).toHaveText('0');
  }
  await expect(page.locator('#statSpares')).toHaveText('5');
});

test.describe('the repair picker', () => {
  test('offers the four repair kinds', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await expect(page.locator('#repairDialog')).toBeVisible();
    for (const kind of ['ocp', 'crystal', 'conduit', 'reactor']) {
      await expect(page.locator(`[data-kind="${kind}"]`)).toBeVisible();
    }
  });

  test('lists targets from the reference data for the selected ship', async ({ page }) => {
    await openTab(page, 'setup');
    await page.selectOption('#setupShip', 'takanami');
    await openTab(page, 'log');

    await page.click('#manualRepairBtn');
    await page.click('[data-kind="ocp"]');
    const choices = page.locator('#repairDialogBody .choice');
    await expect(choices).toHaveCount(3);
    // Takanami's OCP locations, straight out of SHIP_DATA.
    await expect(choices.first()).toContainText('Bridge (by nav station)');
  });

  test('Back returns to the kind list', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await expect(page.locator('#dialogBack')).toBeHidden();
    await page.click('[data-kind="crystal"]');
    await expect(page.locator('#dialogBack')).toBeVisible();
    await page.click('#dialogBack');
    await expect(page.locator('[data-kind="ocp"]')).toBeVisible();
  });

  test('Escape closes it without logging anything', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#repairDialog')).toBeHidden();
    await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
  });
});

test.describe('starting and ending repairs', () => {
  test('an OCP repair starts, counts, and consumes a spare', async ({ page }) => {
    await startRepair(page, 'ocp');
    await expect(page.locator('#repairDialog')).toBeHidden();
    await expect(page.locator('.active-item')).toHaveCount(1);
    await expect(page.locator('#statOcp')).toHaveText('1');
    await expect(page.locator('#statSpares')).toHaveText('4');
    await expect(page.locator('#activeCount')).toHaveText('1');
  });

  test('completing a repair records a start and an end time', async ({ page }) => {
    await startRepair(page, 'ocp');
    await expect(page.locator('#logTableBody tr')).toContainText('running');

    await page.click('.active-item [data-complete]');
    await expect(page.locator('.active-item')).toHaveCount(0);

    const row = page.locator('#logTableBody tr').first();
    // Both clock times present, and an arrow between them.
    await expect(row).toContainText(/\d\d:\d\d:\d\d\s*→\s*\d\d:\d\d:\d\d/);
    await expect(row).not.toContainText('running');
    await expect(row.locator('td').nth(3)).toContainText(/\d+m \d\ds/);
  });

  test('the End button in the log row also completes it', async ({ page }) => {
    await startRepair(page, 'crystal');
    await page.click('#logTableBody [data-complete]');
    await expect(page.locator('.active-item')).toHaveCount(0);
    await expect(page.locator('#logTableBody tr')).not.toContainText('running');
  });

  // Reactor repairs are logged and timed like any other, but deliberately have
  // no stat tile - they belong in the log rather than on the dashboard.
  test('a reactor repair starts immediately with no target menu', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await page.click('[data-kind="reactor"]');
    await expect(page.locator('#repairDialog')).toBeHidden();
    await expect(page.locator('.active-item')).toContainText('Reactor');
    await expect(page.locator('#logTableBody')).toContainText('Reactor repair');
    // The reactor is not an OCP and must not draw down the spares.
    await expect(page.locator('#statSpares')).toHaveText('5');
  });

  test('a reactor repair is timed start to end', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await page.click('[data-kind="reactor"]');
    await expect(page.locator('#logTableBody tr')).toContainText('running');
    await page.click('.active-item [data-complete]');
    const row = page.locator('#logTableBody tr').first();
    await expect(row).toContainText(/\d\d:\d\d:\d\d\s*→\s*\d\d:\d\d:\d\d/);
    await expect(row.locator('td').nth(3)).toContainText(/\d+m \d\ds/);
  });

  test('crystal repairs do not consume OCP spares', async ({ page }) => {
    await startRepair(page, 'crystal');
    await expect(page.locator('#statCrystal')).toHaveText('1');
    await expect(page.locator('#statSpares')).toHaveText('5');
  });
});

test.describe('conduits', () => {
  test('confirm is disabled until something is ticked', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await page.click('[data-kind="conduit"]');
    await expect(page.locator('#dialogConfirm')).toBeDisabled();
    await page.check('#repairDialogBody input >> nth=0');
    await expect(page.locator('#dialogConfirm')).toBeEnabled();
  });

  test('several conduits log as separate entries sharing a start time', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await page.click('[data-kind="conduit"]');
    await page.check('#repairDialogBody input >> nth=0');
    await page.check('#repairDialogBody input >> nth=2');
    await page.check('#repairDialogBody input >> nth=3');
    await expect(page.locator('#dialogConfirm')).toContainText('3');
    await page.click('#dialogConfirm');

    await expect(page.locator('.active-item')).toHaveCount(3);
    await expect(page.locator('#statConduit')).toHaveText('3');

    // Grouped failures share one start time, which is what lets an importer
    // reassemble them as a single event. Checked against the exported ISO
    // timestamps rather than the on-screen clock: the clock is only accurate
    // to the second, so it cannot tell a deliberately shared timestamp from
    // three per-entry ones taken in the same second.
    const wait = page.waitForEvent('download');
    await page.click('#exportJsonBtn');
    const data = JSON.parse(
      readFileSync(await (await wait).path(), 'utf8')
    );
    const starts = data.entries.filter(e => e.kind === 'conduit').map(e => e.startedAt);
    expect(starts).toHaveLength(3);
    expect(new Set(starts).size).toBe(1);
  });

  test('conduits can be completed one at a time', async ({ page }) => {
    await page.click('#manualRepairBtn');
    await page.click('[data-kind="conduit"]');
    await page.check('#repairDialogBody input >> nth=0');
    await page.check('#repairDialogBody input >> nth=1');
    await page.click('#dialogConfirm');

    await page.click('.active-item [data-complete] >> nth=0');
    await expect(page.locator('.active-item')).toHaveCount(1);
    await expect(page.locator('#statConduit')).toHaveText('2');
  });
});

test.describe('OCP spares', () => {
  test('count down from five as repairs start', async ({ page }) => {
    for (let i = 0; i < 3; i++) await startRepair(page, 'ocp', i % 3);
    await expect(page.locator('#statSpares')).toHaveText('2');
    await expect(page.locator('#statOcp')).toHaveText('3');
  });

  test('warn when low and when out', async ({ page }) => {
    for (let i = 0; i < 4; i++) await startRepair(page, 'ocp', i % 3);
    await expect(page.locator('#spareStat')).toHaveClass(/is-low/);
    await startRepair(page, 'ocp');
    await expect(page.locator('#statSpares')).toHaveText('0');
    await expect(page.locator('#spareStat')).toHaveClass(/is-out/);
  });

  test('never go below zero', async ({ page }) => {
    for (let i = 0; i < 7; i++) await startRepair(page, 'ocp', i % 3);
    await expect(page.locator('#statSpares')).toHaveText('0');
  });

  test('can be adjusted by hand', async ({ page }) => {
    await page.click('#spareMinus');
    await expect(page.locator('#statSpares')).toHaveText('4');
    await page.click('#sparePlus');
    await page.click('#sparePlus');
    await expect(page.locator('#statSpares')).toHaveText('6');
  });

  test('deleting an OCP entry returns its spare', async ({ page }) => {
    await startRepair(page, 'ocp');
    await expect(page.locator('#statSpares')).toHaveText('4');
    page.once('dialog', d => d.accept());
    await page.click('.active-item [data-delete]');
    await expect(page.locator('#statOcp')).toHaveText('0');
    await expect(page.locator('#statSpares')).toHaveText('5');
  });
});

test('notes are logged and escaped rather than rendered as markup', async ({ page }) => {
  page.once('dialog', d => d.accept('Coolant weeping <script>alert(1)</script>'));
  await page.click('#noteBtn');

  await expect(page.locator('#logTableBody tr')).toHaveCount(1);
  await expect(page.locator('#logTableBody')).toContainText('Coolant weeping');
  const html = await page.innerHTML('#logTableBody');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
});

test('an empty note is not logged', async ({ page }) => {
  page.once('dialog', d => d.accept('   '));
  await page.click('#noteBtn');
  await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
});

test('the log survives a reload', async ({ page }) => {
  await startRepair(page, 'ocp');
  await page.click('.active-item [data-complete]');
  await startRepair(page, 'crystal');

  await page.reload();
  await openTab(page, 'log');

  await expect(page.locator('#statOcp')).toHaveText('1');
  await expect(page.locator('#statCrystal')).toHaveText('1');
  await expect(page.locator('#statSpares')).toHaveText('4');
  // The unfinished crystal repair is still running, not silently ended.
  await expect(page.locator('.active-item')).toHaveCount(1);
  await expect(page.locator('#logTableBody tr')).toHaveCount(2);
});

test('entries are listed newest first', async ({ page }) => {
  await startRepair(page, 'ocp');
  await startRepair(page, 'crystal');
  const actions = await page.locator('#logTableBody tr td:nth-child(2)').allTextContents();
  expect(actions[0]).toContain('Crystal');
  expect(actions[1]).toContain('OCP');
});
