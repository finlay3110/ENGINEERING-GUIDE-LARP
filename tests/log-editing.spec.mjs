import { test, expect } from '@playwright/test';
import { openTab } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'log');
});

async function startRepair(page, kind, index = 0) {
  await page.click('#manualRepairBtn');
  await page.click(`[data-kind="${kind}"]`);
  if (kind !== 'reactor') await page.click(`#repairDialogBody .choice >> nth=${index}`);
}

async function startConduits(page, count) {
  await page.click('#manualRepairBtn');
  await page.click('[data-kind="conduit"]');
  for (let i = 0; i < count; i++) await page.check(`#repairDialogBody input >> nth=${i}`);
  await page.click('#dialogConfirm');
}

test.describe('elapsed timers', () => {
  test('a running repair shows a clock that ticks', async ({ page }) => {
    await startRepair(page, 'ocp');
    const clock = page.locator('.active-elapsed');
    await expect(clock).toHaveText(/^\d+:\d\d$/);
    const first = await clock.textContent();
    // The interval is 1s; give it room without making the test slow.
    await expect(clock).not.toHaveText(first, { timeout: 4000 });
  });

  test('completed repairs have no running clock', async ({ page }) => {
    await startRepair(page, 'ocp');
    await page.click('.active-item [data-complete]');
    await expect(page.locator('.active-elapsed')).toHaveCount(0);
  });

  // A clock left ticking on a hidden panel burns battery for nothing.
  test('the clock stops when the log is not the open tab', async ({ page }) => {
    await startRepair(page, 'ocp');
    await openTab(page, 'setup');

    // Editing setup re-renders the log behind the scenes, which is the path
    // that would restart the timer on a panel nobody is looking at.
    await page.fill('#missionName', 'Kestrel Relief');

    const before = await page.locator('.active-elapsed').textContent();
    await page.waitForTimeout(2500);
    expect(await page.locator('.active-elapsed').textContent()).toBe(before);

    // Returning to the log resyncs it rather than resuming from a stale value.
    await openTab(page, 'log');
    await expect(page.locator('.active-elapsed')).not.toHaveText(before, { timeout: 4000 });
  });
});

test.describe('complete all', () => {
  test('is offered only when more than one repair is running', async ({ page }) => {
    await expect(page.locator('#completeAllBtn')).toBeHidden();
    await startRepair(page, 'ocp');
    await expect(page.locator('#completeAllBtn')).toBeHidden();
    await startRepair(page, 'crystal');
    await expect(page.locator('#completeAllBtn')).toBeVisible();
  });

  test('closes every running repair in one press', async ({ page }) => {
    await startConduits(page, 3);
    await startRepair(page, 'reactor');
    await expect(page.locator('.active-item')).toHaveCount(4);

    await page.click('#completeAllBtn');

    await expect(page.locator('.active-item')).toHaveCount(0);
    await expect(page.locator('#logTableBody tr')).toHaveCount(4);
    await expect(page.locator('#logTableBody')).not.toContainText('running');
  });
});

test.describe('undo on delete', () => {
  test('deletes immediately with no confirm dialog', async ({ page }) => {
    let asked = false;
    page.on('dialog', d => { asked = true; d.dismiss(); });

    await startRepair(page, 'ocp');
    await page.click('.active-item [data-delete]');

    expect(asked, 'a confirm dialog appeared').toBe(false);
    await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
    await expect(page.locator('#toast')).toBeVisible();
  });

  test('undo restores the entry', async ({ page }) => {
    await startRepair(page, 'crystal');
    await page.click('.active-item [data-complete]');
    await page.click('#logTableBody [data-delete]');
    // An empty log still renders one row: the "Nothing logged yet" placeholder.
    await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');

    await page.click('#toastUndo');

    await expect(page.locator('#logTableBody tr')).toHaveCount(1);
    await expect(page.locator('#logTableBody')).toContainText('Crystal repair');
    await expect(page.locator('#toast')).toBeHidden();
  });

  // The spare has to move both ways, or an accidental delete quietly inflates
  // the locker.
  test('undo re-takes the OCP spare the delete returned', async ({ page }) => {
    await startRepair(page, 'ocp');
    await expect(page.locator('#statSpares')).toHaveText('4');

    await page.click('.active-item [data-delete]');
    await expect(page.locator('#statSpares')).toHaveText('5');

    await page.click('#toastUndo');
    await expect(page.locator('#statSpares')).toHaveText('4');
    await expect(page.locator('#statOcp')).toHaveText('1');
  });

  test('the delete stands once the toast is gone', async ({ page }) => {
    await startRepair(page, 'ocp');
    await page.click('.active-item [data-delete]');
    await page.reload();
    await openTab(page, 'log');
    await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
  });
});

test.describe('editing an entry', () => {
  test('corrects the detail without losing the entry', async ({ page }) => {
    await startRepair(page, 'ocp');
    await page.click('.active-item [data-complete]');

    await page.click('#logTableBody [data-edit]');
    await expect(page.locator('#editDialog')).toBeVisible();
    await page.fill('#editTarget', 'Corrected system');
    await page.click('#editDialog button[type="submit"]');

    await expect(page.locator('#editDialog')).toBeHidden();
    await expect(page.locator('#logTableBody')).toContainText('Corrected system');
    await expect(page.locator('#logTableBody tr')).toHaveCount(1);
    // Still an OCP repair, still counted.
    await expect(page.locator('#statOcp')).toHaveText('1');
  });

  // The point of editing rather than delete-and-redo: the real times survive.
  test('backdates a start time and recomputes the duration', async ({ page }) => {
    await startRepair(page, 'ocp');
    await page.click('.active-item [data-complete]');

    await page.click('#logTableBody [data-edit]');
    await page.fill('#editStart', '18:30:00');
    await page.fill('#editEnd', '18:45:30');
    await page.click('#editDialog button[type="submit"]');

    const row = page.locator('#logTableBody tr').first();
    await expect(row).toContainText('18:30:00');
    await expect(row).toContainText('18:45:30');
    await expect(row).toContainText('15m 30s');
  });

  test('can return a completed repair to running', async ({ page }) => {
    await startRepair(page, 'ocp');
    await page.click('.active-item [data-complete]');
    await expect(page.locator('.active-item')).toHaveCount(0);

    await page.click('#logTableBody [data-edit]');
    await page.click('#editClearEnd');
    await page.click('#editDialog button[type="submit"]');

    await expect(page.locator('.active-item')).toHaveCount(1);
    await expect(page.locator('#logTableBody')).toContainText('running');
  });

  test('rejects an end before the start', async ({ page }) => {
    await startRepair(page, 'ocp');
    await page.click('.active-item [data-complete]');

    await page.click('#logTableBody [data-edit]');
    await page.fill('#editStart', '19:00:00');
    await page.fill('#editEnd', '18:00:00');
    await page.click('#editDialog button[type="submit"]');

    await expect(page.locator('#editError')).toContainText('cannot end before');
    await expect(page.locator('#editDialog')).toBeVisible();
  });

  test('edits a hull reading by value, not by detail text', async ({ page }) => {
    await page.click('#hullBtn');
    await page.fill('#hullValue', '61');
    await page.click('#hullDialog button[type="submit"]');

    await page.click('#logTableBody [data-edit]');
    await expect(page.locator('#editValueField')).toBeVisible();
    await expect(page.locator('#editTargetField')).toBeHidden();
    // An instant event has no separate end to correct.
    await expect(page.locator('#editEndField')).toBeHidden();

    await page.fill('#editValue', '43');
    await page.click('#editDialog button[type="submit"]');
    await expect(page.locator('#logTableBody')).toContainText('43%');
  });

  test('rejects an out-of-range hull value', async ({ page }) => {
    await page.click('#hullBtn');
    await page.fill('#hullValue', '61');
    await page.click('#hullDialog button[type="submit"]');

    await page.click('#logTableBody [data-edit]');
    await page.fill('#editValue', '140');
    await page.click('#editDialog button[type="submit"]');

    await expect(page.locator('#editError')).toContainText('0 to 100');
    await expect(page.locator('#logTableBody')).toContainText('61%');
  });

  test('edits survive a reload', async ({ page }) => {
    await startRepair(page, 'ocp');
    await page.click('.active-item [data-complete]');
    await page.click('#logTableBody [data-edit]');
    await page.fill('#editTarget', 'Persisted edit');
    await page.click('#editDialog button[type="submit"]');

    await page.reload();
    await openTab(page, 'log');
    await expect(page.locator('#logTableBody')).toContainText('Persisted edit');
  });
});
