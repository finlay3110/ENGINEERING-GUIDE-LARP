import { test, expect } from '@playwright/test';
import { openTab, contrastRatio, renderedColours } from './helpers.mjs';

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0; // >=24px, or >=18.66px bold

test.describe('colour contrast', () => {
  // Regression: --danger was #B23A3A, scoring 2.7:1 on the console background
  // and 2.42:1 on the mobile card background - a WCAG AA failure on the
  // overheat warnings, the text most likely to be read at a glance.
  test('danger rows meet AA against whatever is behind them', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'thermal');

    const cells = await page.locator('tr.danger-row td').count();
    expect(cells).toBeGreaterThan(0);

    for (let i = 0; i < cells; i++) {
      const sel = `tr.danger-row td:nth-of-type(${(i % 2) + 1})`;
      const { color, background, fontSize, fontWeight } = await renderedColours(
        page,
        `tr.danger-row:nth-of-type(${Math.floor(i / 2) + 1}) td:nth-of-type(${(i % 2) + 1})`
      ).catch(() => renderedColours(page, sel));

      const large = fontSize >= 24 || (fontSize >= 18.66 && Number(fontWeight) >= 700);
      const ratio = contrastRatio(color, background);
      expect(ratio, `danger cell ${i} at ${fontSize}px/${fontWeight}`)
        .toBeGreaterThanOrEqual(large ? AA_LARGE : AA_NORMAL);
    }
  });

  test('body and muted text meet AA', async ({ page }) => {
    await page.goto('/index.html');
    for (const sel of ['.panel-sub', '.ref-table tbody td', '.ref-table td.sys', '.credit']) {
      const { color, background, fontSize, fontWeight } = await renderedColours(page, sel);
      const large = fontSize >= 24 || (fontSize >= 18.66 && Number(fontWeight) >= 700);
      expect(contrastRatio(color, background), `${sel} at ${fontSize}px`)
        .toBeGreaterThanOrEqual(large ? AA_LARGE : AA_NORMAL);
    }
  });

  test('highlighted warp rows stay readable behind their tint', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'warp');
    await page.fill('#sectorInput', '12');
    const { color, background } = await renderedColours(page, 'tr.bracket-highlight td');
    expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

test.describe('fonts', () => {
  test('serves WOFF2 and never falls back to TTF', async ({ page }) => {
    const requested = [];
    page.on('response', r => {
      const file = r.url().split('/').pop();
      if (/\.(woff2|ttf)$/.test(file)) requested.push(file);
    });

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter(f => f.endsWith('.ttf'))).toEqual([]);
    expect(requested.every(f => f.endsWith('.woff2'))).toBe(true);
  });

  test('both families actually apply', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => document.fonts.ready);
    const families = await page.evaluate(() => ({
      heading: getComputedStyle(document.querySelector('.hdr-titles h1')).fontFamily,
      body: getComputedStyle(document.querySelector('.panel-sub')).fontFamily,
      headingLoaded: document.fonts.check(
        getComputedStyle(document.querySelector('.hdr-titles h1')).font
      ),
    }));
    expect(families.heading).toContain('Orbitron');
    expect(families.body).toContain('Exo 2');
    expect(families.headingLoaded).toBe(true);
  });
});

test.describe('layout', () => {
  test('the page never scrolls horizontally', async ({ page }) => {
    await page.goto('/index.html');
    for (const tab of ['power', 'thermal', 'warp', 'damage']) {
      await openTab(page, tab);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow, `${tab} panel overflows`).toBeLessThanOrEqual(1);
    }
  });

  test('every table cell carries a stacking label', async ({ page }) => {
    // Below 700px the tables restructure into label/value cards driven
    // entirely by data-label, so a missing one renders a blank key.
    await page.goto('/index.html');
    for (const tab of ['power', 'thermal', 'warp']) {
      await openTab(page, tab);
      const missing = await page.evaluate(
        () => [...document.querySelectorAll('.panel.active .ref-table tbody td')]
          .filter(td => !td.getAttribute('data-label')).length
      );
      expect(missing, `${tab} has cells without data-label`).toBe(0);
    }
  });
});

test('no console errors on any tab', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => m.type() === 'error' && errors.push(`console: ${m.text()}`));

  await page.goto('/index.html');
  for (const tab of ['power', 'thermal', 'warp', 'damage']) await openTab(page, tab);

  expect(errors).toEqual([]);
});
