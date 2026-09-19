import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openTab } from './helpers.mjs';

/**
 * Wait for the worker to be installed and in control of the page.
 *
 * The predicate passed to waitForFunction must be synchronous: an async one
 * returns a Promise, which is truthy, so the wait resolves immediately and the
 * assertions then race the worker's activation. `evaluate` does await a
 * returned promise, so the two-step form is the reliable one.
 */
async function waitForServiceWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller,
    null,
    { timeout: 20000 }
  );
}

test.describe('offline support', () => {
  test('registers a service worker scoped to the whole site', async ({ page }) => {
    await page.goto('/index.html');
    await waitForServiceWorker(page);

    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { active: !!r.active, scope: new URL(r.scope).pathname };
    });
    expect(reg.active).toBe(true);
    expect(reg.scope).toBe('/');
  });

  // The assets an export needs are exactly the ones a dead connection would
  // otherwise cost you, so they are precached rather than fetched on demand.
  test('precaches the assets needed to work and export offline', async ({ page }) => {
    await page.goto('/index.html');
    await waitForServiceWorker(page);

    const urls = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names[0]);
      return (await cache.keys()).map(r => new URL(r.url).pathname);
    });

    expect(urls.some(u => u.endsWith('/index.html'))).toBe(true);
    expect(urls.some(u => u.includes('jspdf'))).toBe(true);
    expect(urls.filter(u => u.endsWith('.pdf'))).toHaveLength(2);
    expect(urls.some(u => u.endsWith('.woff2'))).toBe(true);
    // The PDF exporter embeds the TTFs, so those are needed offline too.
    expect(urls.some(u => u.endsWith('.ttf'))).toBe(true);
  });

  test('the page loads and the log survives with no network', async ({ page, context }) => {
    await page.goto('/index.html');
    await waitForServiceWorker(page);

    await openTab(page, 'log');
    await page.click('#hullBtn');
    await page.fill('#hullValue', '61');
    await page.click('#hullDialog button[type="submit"]');

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('.hdr-titles h1')).toBeVisible();
    await openTab(page, 'log');
    await expect(page.locator('#logTableBody')).toContainText('61%');
  });

  // The export is the thing most likely to be wanted at the end of a mission,
  // when the venue network is at its worst. jsPDF is lazily loaded, so without
  // precaching this is exactly where it would fail.
  test('exports a PDF with embedded fonts while offline', async ({ page, context }) => {
    await page.goto('/index.html');
    await waitForServiceWorker(page);

    await openTab(page, 'log');
    await page.click('#manualRepairBtn');
    await page.click('[data-kind="reactor"]');
    await page.click('.active-item [data-complete]');

    await context.setOffline(true);
    await page.reload();
    await openTab(page, 'log');

    const wait = page.waitForEvent('download');
    await page.click('#exportPdfBtn');
    const buf = readFileSync(await (await wait).path());

    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const s = buf.toString('latin1');
    expect(s, 'body font embedded from cache').toContain('/Exo2');
    expect(s, 'heading font embedded from cache').toContain('/Orbitron');
  });

  test('the ship map is available offline', async ({ page, context }) => {
    await page.goto('/index.html');
    await waitForServiceWorker(page);
    await context.setOffline(true);

    const status = await page.evaluate(async () => {
      const res = await fetch('ship-maps/HAVOCK_SHIP_MAP.pdf');
      return { ok: res.ok, type: res.headers.get('content-type') };
    });
    expect(status.ok).toBe(true);
  });
});

test.describe('installability', () => {
  test('serves a manifest describing an installable app', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);

    const m = JSON.parse(await res.text());
    expect(m.name).toContain('UCN');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBeTruthy();
    // A maskable icon is what stops Android cropping the mark badly.
    expect(m.icons.some(i => i.purpose === 'maskable')).toBe(true);
    expect(m.icons.some(i => i.sizes === '512x512')).toBe(true);
  });

  test('every declared icon actually exists', async ({ request }) => {
    const m = JSON.parse(await (await request.get('/manifest.webmanifest')).text());
    for (const icon of m.icons) {
      const res = await request.get('/' + icon.src);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type']).toContain('png');
    }
  });

  test('the page links the manifest and a theme colour', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0E1626');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
});
