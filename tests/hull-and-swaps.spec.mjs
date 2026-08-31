import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openTab } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'log');
});

async function logHull(page, value) {
  await page.click('#hullBtn');
  await page.fill('#hullValue', String(value));
  await page.click('#hullDialog button[type="submit"]');
}

async function exportJson(page) {
  const wait = page.waitForEvent('download');
  await page.click('#exportJsonBtn');
  return JSON.parse(readFileSync(await (await wait).path(), 'utf8'));
}

test.describe('power cell swap', () => {
  // Deliberately not part of the manual repair menu: the swap is the whole
  // event, so it is one button rather than a nested target picker.
  test('logs in a single tap with no menu', async ({ page }) => {
    await page.click('#cellSwapBtn');
    await expect(page.locator('#repairDialog')).toBeHidden();
    await expect(page.locator('#statSwap')).toHaveText('1');
    await expect(page.locator('#logTableBody tr')).toHaveCount(1);
    await expect(page.locator('#logTableBody')).toContainText('Power cell swapped');
  });

  test('is an instant event, not a timed repair', async ({ page }) => {
    await page.click('#cellSwapBtn');
    // Nothing to complete, no start-to-end arrow, no duration.
    await expect(page.locator('.active-item')).toHaveCount(0);
    const row = page.locator('#logTableBody tr').first();
    await expect(row).not.toContainText('→');
    await expect(row).not.toContainText('running');
    await expect(row.locator('td').nth(3)).toHaveText('—');
  });

  test('does not consume an OCP spare or count as a crystal repair', async ({ page }) => {
    await page.click('#cellSwapBtn');
    await expect(page.locator('#statSpares')).toHaveText('5');
    await expect(page.locator('#statCrystal')).toHaveText('0');
  });

  test('counts each swap', async ({ page }) => {
    for (let i = 0; i < 3; i++) await page.click('#cellSwapBtn');
    await expect(page.locator('#statSwap')).toHaveText('3');
  });

  // The action shipped briefly as "crystalSwap" before the part was correctly
  // named a power cell. Anyone who used it in that window has stored entries
  // under the old kind, which would otherwise render as a raw string.
  test('entries stored under the old kind name still load', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('ucn-mission-v1', JSON.stringify({
        entries: [{
          id: 'legacy1',
          kind: 'crystalSwap',
          startedAt: '2026-01-01T10:00:00.000Z',
          endedAt: '2026-01-01T10:00:00.000Z',
          ship: 'havock',
        }],
      }));
    });
    await page.reload();
    await openTab(page, 'log');

    await expect(page.locator('#logTableBody')).toContainText('Power cell swapped');
    await expect(page.locator('#logTableBody')).not.toContainText('crystalSwap');
    await expect(page.locator('#statSwap')).toHaveText('1');
  });
});

// Hull readings live in the action log and the exports. They deliberately get
// no stat tile, so every assertion here reads the log rather than a counter.
test.describe('hull integrity', () => {
  const rows = page => page.locator('#logTableBody tr');

  test('has no stat tile', async ({ page }) => {
    await expect(page.locator('#statHull')).toHaveCount(0);
    await expect(page.locator('#hullStat')).toHaveCount(0);
  });

  test('starts unrecorded', async ({ page }) => {
    await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
  });

  test('records a reading with its value and time', async ({ page }) => {
    await logHull(page, 72);
    await expect(page.locator('#hullDialog')).toBeHidden();

    const row = rows(page).first();
    await expect(row).toContainText('Hull integrity');
    await expect(row).toContainText('72%');
    await expect(row.locator('td').first()).toHaveText(/\d\d:\d\d:\d\d/);
  });

  test('quick buttons fill the value', async ({ page }) => {
    await page.click('#hullBtn');
    await page.click('#hullQuick [data-value="50"]');
    await expect(page.locator('#hullValue')).toHaveValue('50');
    await page.click('#hullDialog button[type="submit"]');
    await expect(rows(page).first()).toContainText('50%');
  });

  test('readings accumulate rather than overwrite', async ({ page }) => {
    await logHull(page, 100);
    await logHull(page, 64);
    await logHull(page, 30);

    await expect(rows(page)).toHaveCount(3);
    // Newest first, and every reading kept rather than replaced.
    const details = await rows(page).locator('td:nth-child(3)').allTextContents();
    expect(details).toEqual(['30%', '64%', '100%']);
  });

  test('the dialog prefills the last reading', async ({ page }) => {
    await logHull(page, 80);
    await page.click('#hullBtn');
    await expect(page.locator('#hullValue')).toHaveValue('80');
  });

  test('is an instant event with no duration', async ({ page }) => {
    await logHull(page, 60);
    await expect(page.locator('.active-item')).toHaveCount(0);
    const row = rows(page).first();
    await expect(row).not.toContainText('→');
    await expect(row.locator('td').nth(3)).toHaveText('—');
  });

  test.describe('validation', () => {
    // The form is novalidate so these messages come from the app rather than
    // the browser's own bubble, which cannot say anything useful here.
    for (const [value, why] of [
      ['150', 'above 100'],
      ['-5', 'below 0'],
      ['', 'empty'],
    ]) {
      test(`rejects ${why}`, async ({ page }) => {
        await page.click('#hullBtn');
        await page.fill('#hullValue', value);
        await page.click('#hullDialog button[type="submit"]');
        await expect(page.locator('#hullError')).not.toHaveText('');
        await expect(page.locator('#hullDialog')).toBeVisible();
        // Nothing reached the log.
        await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
      });
    }

    test('accepts the boundaries', async ({ page }) => {
      await logHull(page, 0);
      await expect(rows(page).first()).toContainText('0%');
      await logHull(page, 100);
      await expect(rows(page).first()).toContainText('100%');
      await expect(rows(page)).toHaveCount(2);
    });

    test('clears the error once a good value is entered', async ({ page }) => {
      await page.click('#hullBtn');
      await page.fill('#hullValue', '150');
      await page.click('#hullDialog button[type="submit"]');
      await expect(page.locator('#hullError')).not.toHaveText('');
      await page.click('#hullQuick [data-value="75"]');
      await expect(page.locator('#hullError')).toHaveText('');
    });
  });

  test('survives a reload', async ({ page }) => {
    await logHull(page, 55);
    await page.click('#cellSwapBtn');
    await page.reload();
    await openTab(page, 'log');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#logTableBody')).toContainText('55%');
    await expect(page.locator('#statSwap')).toHaveText('1');
  });
});

test.describe('export', () => {
  test('carries hull readings as a series, oldest first', async ({ page }) => {
    await logHull(page, 100);
    await logHull(page, 60);
    await logHull(page, 25);

    const data = await exportJson(page);
    expect(data.hull.latest).toBe(25);
    expect(data.hull.latestAt).toMatch(/Z$/);
    expect(data.hull.readings.map(r => r.value)).toEqual([100, 60, 25]);
    for (const r of data.hull.readings) expect(r.at).toMatch(/Z$/);
  });

  test('reports no hull data when none was recorded', async ({ page }) => {
    await page.click('#cellSwapBtn');
    const data = await exportJson(page);
    expect(data.hull.latest).toBeNull();
    expect(data.hull.latestAt).toBeNull();
    expect(data.hull.readings).toEqual([]);
  });

  test('value is set on hull entries and null elsewhere', async ({ page }) => {
    await logHull(page, 42);
    await page.click('#cellSwapBtn');

    const data = await exportJson(page);
    expect(data.entries.find(e => e.kind === 'hull').value).toBe(42);
    expect(data.entries.find(e => e.kind === 'cellSwap').value).toBeNull();
  });

  // A zero-second duration would read as an instant repair rather than an
  // event that happened at a point in time.
  test('instant kinds export a null duration', async ({ page }) => {
    await logHull(page, 42);
    await page.click('#cellSwapBtn');
    page.once('dialog', d => d.accept('a note'));
    await page.click('#noteBtn');

    const data = await exportJson(page);
    const instants = data.entries.filter(e =>
      ['hull', 'cellSwap', 'note'].includes(e.kind));
    expect(instants).toHaveLength(3);
    for (const e of instants) {
      expect(e.durationSeconds, `${e.kind} duration`).toBeNull();
      expect(e.endedAt, `${e.kind} endedAt`).not.toBeNull();
    }
  });

  test('totals count the new kinds', async ({ page }) => {
    await logHull(page, 80);
    await logHull(page, 70);
    await page.click('#cellSwapBtn');

    const data = await exportJson(page);
    expect(data.totals.hull).toBe(2);
    expect(data.totals.cellSwap).toBe(1);
  });

  test('the PDF still builds with the new kinds present', async ({ page }) => {
    await logHull(page, 80);
    await page.click('#cellSwapBtn');

    const wait = page.waitForEvent('download');
    await page.click('#exportPdfBtn');
    const buf = readFileSync(await (await wait).path());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
