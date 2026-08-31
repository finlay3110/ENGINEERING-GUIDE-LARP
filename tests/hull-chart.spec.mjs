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
      mission: { name: 'Kestrel Relief', type: 'Frontline', startedAt: new Date(base).toISOString() },
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

/**
 * Count pixels inside the plot area that are neither background nor gridline.
 *
 * Checking only that a PNG came back is not enough: canvas silently ignores
 * NaN coordinates, so a broken axis produces a perfectly valid image with no
 * data drawn on it. This looks at what actually landed on the canvas.
 */
async function plottedPixels(page, buf) {
  return page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);

    // Sample the plot area only, away from the header and axis labels.
    const x0 = Math.floor(bmp.width * 0.1);
    const x1 = Math.floor(bmp.width * 0.98);
    const y0 = Math.floor(bmp.height * 0.2);
    const y1 = Math.floor(bmp.height * 0.85);
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);

    // The series line and points are markedly bluer or redder than the dark
    // navy ground and the low-contrast gridlines.
    let plotted = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, bl] = [data[i], data[i + 1], data[i + 2]];
      if (bl > 120 && g > 100) plotted++;      // cyan line and points
      else if (r > 150 && bl < 140) plotted++; // amber and red points
    }
    return plotted;
  }, buf.toString('base64'));
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

  // Threshold sits between a full plot and points-only: a four-point series
  // measures ~6,600 plotted pixels with its connecting line and ~590 without,
  // so this catches the line going missing as well as the whole series.
  test('actually plots the series and its line', async ({ page }) => {
    await seedSeries(page, [100, 80, 55, 30]);
    const { buf } = await download(page, '#exportChartBtn');
    expect(await plottedPixels(page, buf)).toBeGreaterThan(3000);
  });

  test('a single reading charts without error', async ({ page }) => {
    await logHull(page, 55);
    const { buf } = await download(page, '#exportChartBtn');
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(await plottedPixels(page, buf)).toBeGreaterThan(0);
  });

  // Every reading sharing a timestamp gives the time axis a zero span. Dividing
  // by it yields NaN, and canvas ignores NaN coordinates silently — so the
  // export would still be a valid PNG with nothing drawn on it. The pixel count
  // is what catches that.
  test('readings with identical timestamps still plot', async ({ page }) => {
    await seedSeries(page, [70, 55, 40], 0);
    const { buf } = await download(page, '#exportChartBtn');
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(await plottedPixels(page, buf)).toBeGreaterThan(3000);
  });

  test('the chart export needs no PDF library', async ({ page }) => {
    const hits = [];
    page.on('request', r => r.url().includes('jspdf') && hits.push(r.url()));

    await seedSeries(page, [90, 60, 30]);
    await download(page, '#exportChartBtn');
    expect(hits).toHaveLength(0);
  });
});
