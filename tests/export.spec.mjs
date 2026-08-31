import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openTab } from './helpers.mjs';

/** A mission with one completed repair, one still running, and a note. */
async function seedMission(page) {
  await page.goto('/index.html');
  await page.fill('#opName', 'Fin');
  await page.fill('#opRank', 'Lt');
  await page.fill('#missionName', 'Kestrel Relief');
  await page.fill('#missionType', 'Patrol');
  await page.click('#nowBtn');
  await openTab(page, 'log');

  await page.click('#manualRepairBtn');
  await page.click('[data-kind="ocp"]');
  await page.click('#repairDialogBody .choice >> nth=0');
  await page.click('.active-item [data-complete]');

  await page.click('#manualRepairBtn');
  await page.click('[data-kind="conduit"]');
  await page.check('#repairDialogBody input >> nth=0');
  await page.click('#dialogConfirm');

  page.once('dialog', d => d.accept('Coolant weeping at frame 12'));
  await page.click('#noteBtn');
}

async function downloadJson(page) {
  const wait = page.waitForEvent('download');
  await page.click('#exportJsonBtn');
  const file = await wait;
  return {
    name: file.suggestedFilename(),
    data: JSON.parse(readFileSync(await file.path(), 'utf8')),
  };
}

test('JSON export carries the whole mission', async ({ page }) => {
  await seedMission(page);
  const { name, data } = await downloadJson(page);

  expect(name).toMatch(/^ucn-log-kestrel-relief.*\.json$/);
  expect(data.schema).toBe('ucn.engineering.log/1');
  expect(data.operator).toMatchObject({ name: 'Fin', rank: 'Lt' });
  expect(data.mission).toMatchObject({ name: 'Kestrel Relief', type: 'Patrol' });
  expect(data.ship).toMatchObject({ id: 'havock', name: 'UCS Havock' });
  expect(data.entries).toHaveLength(3);
  expect(data.totals).toMatchObject({ ocp: 1, conduit: 1, note: 1, crystal: 0, reactor: 0 });
  expect(data.spares).toMatchObject({ start: 5, remaining: 4, used: 1 });
});

test('exported timestamps are ISO 8601 UTC', async ({ page }) => {
  await seedMission(page);
  const { data } = await downloadJson(page);
  const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
  expect(data.exportedAt).toMatch(iso);
  expect(data.mission.startedAt).toMatch(iso);
  for (const e of data.entries) {
    expect(e.startedAt, `entry ${e.kind}`).toMatch(iso);
    if (e.endedAt) expect(e.endedAt).toMatch(iso);
  }
});

// An unfinished repair is a real state at export time, not a corrupt row.
test('a running repair exports with a null end and null duration', async ({ page }) => {
  await seedMission(page);
  const { data } = await downloadJson(page);

  const running = data.entries.find(e => e.kind === 'conduit');
  expect(running.endedAt).toBeNull();
  expect(running.durationSeconds).toBeNull();

  const finished = data.entries.find(e => e.kind === 'ocp');
  expect(finished.endedAt).not.toBeNull();
  expect(typeof finished.durationSeconds).toBe('number');
  expect(finished.durationSeconds).toBeGreaterThanOrEqual(0);
});

test('note text is exported verbatim, not HTML-escaped', async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'log');
  page.once('dialog', d => d.accept('Valve <A> & <B> failed'));
  await page.click('#noteBtn');

  const { data } = await downloadJson(page);
  // Escaping belongs to rendering. The file should hold what was typed, so a
  // consuming app can escape it for its own output.
  expect(data.entries[0].note).toBe('Valve <A> & <B> failed');
});

test('PDF export produces a real PDF', async ({ page }) => {
  await seedMission(page);
  const wait = page.waitForEvent('download');
  await page.click('#exportPdfBtn');
  const file = await wait;

  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const buf = readFileSync(await file.path());
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(buf.length).toBeGreaterThan(1000);
});

// jsPDF is ~360KB. Most sessions never export, and this page gets opened on
// phone data, so it must not be part of the initial load.
test('the PDF library is only fetched when export is pressed', async ({ page }) => {
  const hits = [];
  page.on('request', r => r.url().includes('jspdf') && hits.push(r.url()));

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await openTab(page, 'log');
  expect(hits).toHaveLength(0);

  const wait = page.waitForEvent('download');
  await page.click('#exportPdfBtn');
  await wait;
  expect(hits.length).toBeGreaterThan(0);
});

test.describe('handover prompt', () => {
  test('describes the format it ships with', async ({ page }) => {
    await seedMission(page);
    await page.click('#importPromptBtn');
    await expect(page.locator('#promptDialog')).toBeVisible();

    const text = await page.inputValue('#promptText');
    expect(text).toContain('ucn.engineering.log/1');
    for (const kind of ['ocp', 'crystal', 'conduit', 'reactor', 'note']) {
      expect(text, `documents kind ${kind}`).toContain(`"${kind}"`);
    }
    // The rules an importer would otherwise have to guess at.
    expect(text).toMatch(/null/);
    expect(text).toMatch(/UTC/);
    expect(text).toMatch(/untrusted/i);
    expect(text).toMatch(/sort/i);
  });

  test('embeds a sample taken from the current mission', async ({ page }) => {
    await seedMission(page);
    await page.click('#importPromptBtn');
    const text = await page.inputValue('#promptText');

    // Anchor on the section marker rather than the first brace: the prose
    // above it describes object shapes and contains braces of its own.
    const marker = text.indexOf('EXAMPLE');
    expect(marker, 'prompt should have an EXAMPLE section').toBeGreaterThan(-1);
    const sample = text.slice(text.indexOf('{', marker));
    const parsed = JSON.parse(sample);
    expect(parsed.schema).toBe('ucn.engineering.log/1');
    expect(parsed.operator.name).toBe('Fin');
    // Trimmed so the prompt stays readable rather than pasting the whole log.
    expect(parsed.entries.length).toBeLessThanOrEqual(2);
  });
});
