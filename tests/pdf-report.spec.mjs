import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { openTab } from './helpers.mjs';

/**
 * Structural probes over the raw PDF.
 *
 * The document is built with compress:true and its text is hex-encoded against
 * embedded font glyph ids, so the words are not greppable without a full PDF
 * parser. Object dictionaries are not compressed, which is enough to assert
 * the things that actually matter here: page structure, embedded fonts, the
 * clickable contents page, and whether anything was rasterised.
 */
function probe(buf) {
  const s = buf.toString('latin1');
  const count = needle => s.split(needle).length - 1;
  return {
    isPdf: s.startsWith('%PDF-'),
    pages: count('/Type /Page') - count('/Type /Pages'),
    images: count('/Subtype /Image'),
    links: count('/Subtype /Link'),
    linkTargets: [...s.matchAll(/\/Dest \[(\d+) 0 R/g)].map(m => m[1]),
    hasFont: name => s.includes('/' + name),
    bytes: buf.length,
  };
}

/**
 * Whether the page text was drawn with the embedded fonts or the fallback.
 *
 * A registered font is not necessarily a used one - jsPDF lists all of them in
 * the resource dictionary either way, so grepping for "/Exo2" proves nothing.
 * What differs is the encoding: embedded TrueType writes glyph ids as hex
 * strings, while the built-in helvetica writes literal text.
 */
function textEncoding(buf) {
  const s = buf.toString('latin1');
  let streams = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      streams += inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1');
    } catch { /* not a deflate stream */ }
  }
  return {
    hex: (streams.match(/<[0-9A-Fa-f]{4,}>\s*Tj/g) || []).length,
    literal: (streams.match(/\((?:[^()\\]|\\.)+\)\s*Tj/g) || []).length,
  };
}

async function seedMission(page, { hull = true } = {}) {
  await page.evaluate(({ hull }) => {
    const base = Date.parse('2026-08-31T19:00:00Z');
    const t = m => new Date(base + m * 60000).toISOString();
    const entries = [];
    let i = 0;
    const add = o => entries.push(Object.assign({ id: 'e' + i++, ship: 'havock' }, o));

    add({ kind: 'ocp', target: 'Impulse', location: 'Engineering Corridor', startedAt: t(4), endedAt: t(9) });
    add({ kind: 'crystal', target: 'Beams', location: 'Ready Room', startedAt: t(33), endedAt: t(40) });
    add({ kind: 'conduit', target: '1', location: 'Bridge', startedAt: t(52), endedAt: null });
    add({ kind: 'reactor', target: 'Reactor', startedAt: t(70), endedAt: t(83) });
    add({ kind: 'cellSwap', startedAt: t(88), endedAt: t(88) });
    add({ kind: 'note', note: 'Coolant line weeping at frame 12.', startedAt: t(95), endedAt: t(95) });
    if (hull) {
      [100, 88, 74, 55, 22].forEach((v, k) =>
        add({ kind: 'hull', value: v, startedAt: t(k * 12), endedAt: t(k * 12) }));
    }

    localStorage.setItem('ucn-mission-v1', JSON.stringify({
      operator: { name: 'Fin', rank: 'Lt' },
      mission: { name: 'Kestrel Relief', type: 'Frontline', startedAt: new Date(base).toISOString() },
      ship: 'havock', modules: { power: true, damage: true }, spares: 2, entries,
    }));
  }, { hull });
  await page.reload();
  await openTab(page, 'log');
}

async function exportPdf(page) {
  const wait = page.waitForEvent('download');
  await page.click('#exportPdfBtn');
  return readFileSync(await (await wait).path());
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'log');
});

test('builds a cover, a contents page and one page per section', async ({ page }) => {
  await seedMission(page);
  const p = probe(await exportPdf(page));

  expect(p.isPdf).toBe(true);
  // Cover, reserved contents page, then Summary, Hull Integrity, Action Log
  // and Notes.
  expect(p.pages).toBe(6);
});

// The contents page is written last onto a page reserved up front, which is
// what gets the page numbers right without rendering the document twice.
test('the contents page links to every section', async ({ page }) => {
  await seedMission(page);
  const p = probe(await exportPdf(page));

  expect(p.links).toBe(4);
  // Four distinct destinations, one per section.
  expect(new Set(p.linkTargets).size).toBe(4);
});

test('embeds and uses the house fonts', async ({ page }) => {
  await seedMission(page);
  const buf = await exportPdf(page);
  const p = probe(buf);

  expect(p.hasFont('Exo2'), 'body font registered').toBe(true);
  expect(p.hasFont('Orbitron'), 'heading font registered').toBe(true);

  // Registered is not the same as used, so check the text encoding too.
  const enc = textEncoding(buf);
  expect(enc.hex, 'glyph-encoded runs').toBeGreaterThan(20);
  expect(enc.literal, 'literal runs, meaning the fallback was used').toBe(0);
});

// A font that fails to load must cost the typeface, not the export.
test('still exports when the fonts cannot be fetched', async ({ page }) => {
  await page.route('**/fonts/*.ttf', route => route.abort());
  await seedMission(page);

  const buf = await exportPdf(page);
  expect(probe(buf).isPdf).toBe(true);
  expect(probe(buf).pages).toBe(6);
  await expect(page.locator('#exportNote')).toContainText('PDF exported');

  // Fell back to a built-in font, which writes literal text rather than
  // glyph ids.
  const enc = textEncoding(buf);
  expect(enc.literal, 'fallback text runs').toBeGreaterThan(20);
});

test.describe('the chart is vector, not a bitmap', () => {
  // The only raster in the document is the cover logo. If the chart were
  // rasterised, a mission with readings would carry more images than one
  // without — and the file would balloon, as it did when the chart was a PNG.
  test('adds no image when hull readings are present', async ({ page }) => {
    await seedMission(page, { hull: false });
    const without = probe(await exportPdf(page));

    await seedMission(page, { hull: true });
    const withHull = probe(await exportPdf(page));

    expect(withHull.images).toBe(without.images);
  });

  test('keeps the report small', async ({ page }) => {
    await seedMission(page);
    const p = probe(await exportPdf(page));
    expect(p.bytes).toBeLessThan(300 * 1024);
  });
});

test('a mission with no hull readings still produces every section', async ({ page }) => {
  await seedMission(page, { hull: false });
  const p = probe(await exportPdf(page));

  // The hull section prints its empty state rather than being dropped, so the
  // contents page stays consistent between reports.
  expect(p.pages).toBe(6);
  expect(p.links).toBe(4);
});

test('an empty mission still produces a valid report', async ({ page }) => {
  const p = probe(await exportPdf(page));
  expect(p.isPdf).toBe(true);
  expect(p.pages).toBe(6);
  expect(p.links).toBe(4);
});
