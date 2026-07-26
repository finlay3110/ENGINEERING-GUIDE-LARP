import { test, expect } from '@playwright/test';
import { openTab } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await openTab(page, 'warp');
});

const note = page => page.locator('#warpNote');
const rows = page => page.locator('#warpTableBody tr');

test.describe('by distance', () => {
  test('defaults to the all-distance setup', async ({ page }) => {
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('∞');
    await expect(note(page)).toContainText('all-distance');
  });

  test('intro copy is supplied by JS, not duplicated in the markup', async ({ page }) => {
    // The text used to exist verbatim in index.html as well; if it is ever
    // hard-coded there again this still passes, so also assert the element
    // ships empty and is filled in at runtime.
    await expect(page.locator('#warpIntro')).toContainText('Enter a distance');
    const shipped = await page.evaluate(async () => {
      const html = await (await fetch('/index.html')).text();
      return /id="warpIntro"[^>]*>\s*</.test(html);
    });
    expect(shipped, '#warpIntro should be empty in the served HTML').toBe(true);
  });

  test('renders an exact match', async ({ page }) => {
    await page.fill('#sectorInput', '10');
    await expect(rows(page)).toHaveCount(1);
    await expect(note(page)).toContainText('Exact match for 10 sectors');
  });

  test('brackets a distance between two tabled entries', async ({ page }) => {
    await page.fill('#sectorInput', '12');
    await expect(rows(page)).toHaveCount(2);
    await expect(note(page)).toContainText('between 10 and 15');
  });

  test('handles distances below the shortest tabled entry', async ({ page }) => {
    await page.fill('#sectorInput', '2');
    await expect(rows(page)).toHaveCount(1);
    await expect(note(page)).toContainText('below the shortest tabled distance (5)');
  });

  test('pairs the longest entry with the fallback beyond the table', async ({ page }) => {
    await page.fill('#sectorInput', '99');
    await expect(rows(page)).toHaveCount(2);
    await expect(note(page)).toContainText('beyond the longest tabled distance (50)');
    await expect(rows(page).last()).toContainText('∞');
  });

  test('reset returns to the all-distance setup', async ({ page }) => {
    await page.fill('#sectorInput', '25');
    await expect(note(page)).toContainText('Exact match');
    await page.click('#sectorClear');
    await expect(page.locator('#sectorInput')).toHaveValue('');
    await expect(note(page)).toContainText('all-distance');
  });

  test('rejects zero and negative distances', async ({ page }) => {
    await page.fill('#sectorInput', '0');
    await expect(rows(page)).toHaveCount(0);
    await expect(note(page)).toContainText('positive number');
  });

  // Regression: a number input reports value === '' for text it holds but
  // cannot parse, which previously fell through to the empty-field branch and
  // presented the all-distance setup as though it were the answer.
  for (const junk of ['-', '.', '1e', '1-2', '+']) {
    test(`rejects malformed numeric input ${JSON.stringify(junk)}`, async ({ page }) => {
      await page.locator('#sectorInput').pressSequentially(junk);
      await expect(page.locator('#sectorInput')).toHaveValue('');
      await expect(rows(page)).toHaveCount(0);
      await expect(note(page)).toContainText('not a number');
    });
  }

  test('letters never reach the page, so the empty state stands', async ({ page }) => {
    // The browser discards these keystrokes at the input; the field stays
    // visibly empty, and the empty state is the correct response to that.
    await page.locator('#sectorInput').pressSequentially('abc');
    await expect(page.locator('#sectorInput')).toHaveValue('');
    await expect(note(page)).toContainText('all-distance');
  });
});

test.describe('by warp level', () => {
  test.beforeEach(async ({ page }) => {
    await page.click('[data-mode="level"]');
  });

  test('prompts before a level is chosen', async ({ page }) => {
    await expect(rows(page)).toHaveCount(0);
    await expect(note(page)).toContainText('Choose a warp level');
  });

  // Regression: Warp 1 matches only the distance-agnostic fallback row, so the
  // old wording claimed "all tabled distances" beside a row reading "∞".
  test('describes Warp 1 as the fallback rather than a tabled distance', async ({ page }) => {
    await page.click('[data-level="1"]');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('∞');
    await expect(note(page)).toContainText('only used by the all-distance');
    await expect(note(page)).not.toContainText('Showing all tabled distances');
  });

  test('lists every tabled distance for a real level', async ({ page }) => {
    await page.click('[data-level="2"]');
    await expect(rows(page)).toHaveCount(8);
    await expect(note(page)).toContainText('Showing all tabled distances that use Warp 2');
  });

  test('tracks the pressed level', async ({ page }) => {
    await page.click('[data-level="4"]');
    await expect(page.locator('[data-level="4"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-level="2"]')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('show all', () => {
  test('lists every setup including the fallback', async ({ page }) => {
    await page.click('[data-mode="all"]');
    await expect(rows(page)).toHaveCount(11);
    await expect(note(page)).toContainText('all 11 tabled setups');
  });
});

test('mode buttons track pressed state and swap the controls', async ({ page }) => {
  await expect(page.locator('[data-mode="distance"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#distanceControls')).toBeVisible();

  await page.click('[data-mode="level"]');
  await expect(page.locator('[data-mode="level"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-mode="distance"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#distanceControls')).toBeHidden();
  await expect(page.locator('#levelControls')).toBeVisible();
});

test('data carries no unrendered HTML entities', async ({ page }) => {
  await page.click('[data-mode="all"]');
  const text = await page.locator('#warpTableBody').innerText();
  expect(text).not.toMatch(/&(mdash|infin|amp|nbsp);/);
  expect(text).toContain('∞');
  expect(text).toContain('—');
});
