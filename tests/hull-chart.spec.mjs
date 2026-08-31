import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openTab } from './helpers.mjs';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'log');
});

async function logHull(page, value) {
  await page.click('#hullBtn');
  await page.fill('#hullValue', String(value));
  await page.click('#hullDialog button[type="submit"]');
}

/** Write a series directly, so readings can be spread over a realistic
 *  mission rather than crammed into the same second. */
async function seedSeries(page, values, minutesApart = 11) {
  await page.evaluate(({ values, minutesApart }) => {
    const base = Date.parse('2026-08-31T19:00:00Z');
    localStorage.setItem('ucn-mission-v1', JSON.stringify({
      operator: { name: 'Fin', rank: 'Lt' },
      mission: { name: 'Kestrel Relief', type: 'Patrol', startedAt: new Date(base).toISOString() },
      ship: 'havock',
      entries: values.map((v, i) => {
        const t = new Date(base + i * minutesApart * 60000).toISOString();
        return { id: 'h' + i, kind: 'hull', value: v, ship: 'havock', startedAt: t, endedAt: t };
      }),
    }));
  }, { values, minutesApart });
  await page.reload();
  await openTab(page, 'log');
}

async function download(page, selector) {
  const wait = page.waitForEvent('download');
  await page.click(selector);
  const file = await wait;
  return { name: file.suggestedFilename(), buf: readFileSync(await file.path()) };
}

test.describe('chart export', () => {
  test('exports a PNG named for the mission', async ({ page }) => {
    await seedSeries(page, [100, 80, 55, 30]);
    const { name, buf } = await download(page, '#exportChartBtn');

    expect(name).toMatch(/^ucn-log-kestrel-relief.*-hull\.png$/);
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  // Nothing to plot is a normal state, not an error, and must not produce an
  // empty pair of axes or a broken download.
  test('says so when there are no readings, and downloads nothing', async ({ page }) => {
    let started = false;
    page.on('download', () => { started = true; });

    await page.click('#exportChartBtn');
    await expect(page.locator('#exportNote')).toContainText('nothing to chart');
    expect(started).toBe(false);
  });

  test('a single reading charts without error', async ({ page }) => {
    await logHull(page, 55);
    const { buf } = await download(page, '#exportChartBtn');
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  // Every reading sharing a timestamp gives the time axis a zero span, which
  // divides by zero unless the code falls back to even spacing.
  test('readings with identical timestamps chart without error', async ({ page }) => {
    await seedSeries(page, [70, 55, 40], 0);
    const { buf } = await download(page, '#exportChartBtn');
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  test('the chart export needs no PDF library', async ({ page }) => {
    const hits = [];
    page.on('request', r => r.url().includes('jspdf') && hits.push(r.url()));

    await seedSeries(page, [90, 60, 30]);
    await download(page, '#exportChartBtn');
    expect(hits).toHaveLength(0);
  });
});

test.describe('chart in the PDF', () => {
  test('is embedded when there are readings', async ({ page }) => {
    await seedSeries(page, [100, 74, 41, 22]);
    const { buf } = await download(page, '#exportPdfBtn');

    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    // "/Subtype /Image" marks a real embedded bitmap. A bare "/Image" match
    // would be satisfied by jsPDF's default "/ImageB" ProcSet entry, which is
    // present whether or not any image was added.
    expect(buf.toString('latin1')).toContain('/Subtype /Image');
  });

  test('is omitted when no readings were taken', async ({ page }) => {
    await page.click('#cellSwapBtn');
    const { buf } = await download(page, '#exportPdfBtn');

    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    // No chart, so no embedded bitmap at all.
    expect(buf.toString('latin1')).not.toContain('/Subtype /Image');
  });

  // Regression: jsPDF stores the bitmap raw unless told to compress, which
  // turned a text report into a 4MB file.
  test('stays small with the chart embedded', async ({ page }) => {
    await seedSeries(page, [100, 96, 88, 74, 55, 41, 33, 22]);
    const { buf } = await download(page, '#exportPdfBtn');
    expect(buf.length).toBeLessThan(500 * 1024);
  });

  test('reports the hull summary alongside the chart', async ({ page }) => {
    await seedSeries(page, [100, 60, 22]);
    const { buf } = await download(page, '#exportPdfBtn');
    // jsPDF writes text uncompressed here, so it is greppable.
    expect(buf.toString('latin1')).toMatch(/Hull integrity/);
  });
});
