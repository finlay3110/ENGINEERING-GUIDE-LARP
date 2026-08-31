import { test, expect } from '@playwright/test';

const TABS = ['setup', 'log', 'power', 'thermal', 'warp', 'damage'];

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

/** The visible bar for this project, and the tab names it shows in order.
 *  Derived from the DOM so adding or hiding a tab doesn't invalidate the
 *  keyboard tests. */
async function visibleBar(page) {
  const sel = (await page.locator('.tabs').isVisible()) ? '.tabs' : '.bottom-tabs';
  const order = await page.evaluate(
    s => [...document.querySelectorAll(`${s} [role="tab"]`)]
      .filter(t => !t.hidden).map(t => t.dataset.tab),
    sel
  );
  return { sel, order };
}

test('exactly one tab bar is visible at a time', async ({ page }) => {
  const top = await page.locator('.tabs').isVisible();
  const bottom = await page.locator('.bottom-tabs').isVisible();
  expect(top).not.toBe(bottom);
});

test('every tab is wired to its panel', async ({ page }) => {
  const wiring = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map(t => {
      const panel = document.getElementById(t.getAttribute('aria-controls') || '');
      return {
        tab: t.dataset.tab,
        controls: !!panel,
        isPanel: panel?.getAttribute('role') === 'tabpanel',
        // Both bars point at the same panels, so only the top bar's tabs -
        // the ones carrying ids - can be the labelling element.
        labelled: !t.id || panel?.getAttribute('aria-labelledby') === t.id,
      };
    })
  );
  // Two bars, every tab in each.
  expect(wiring).toHaveLength(TABS.length * 2);
  for (const w of wiring) {
    expect(w, `tab ${w.tab}`).toMatchObject({ controls: true, isPanel: true, labelled: true });
  }
});

test('selecting a tab shows one panel and marks one tab selected', async ({ page }) => {
  for (const name of TABS) {
    const bar = (await page.locator('.tabs').isVisible()) ? '.tabs' : '.bottom-tabs';
    await page.click(`${bar} [data-tab="${name}"]`);

    await expect(page.locator('.panel.active')).toHaveCount(1);
    await expect(page.locator(`#panel-${name}`)).toBeVisible();
    // Both bars stay in sync, so each reports its own selected tab.
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(2);
    await expect(page.locator(`${bar} [data-tab="${name}"]`))
      .toHaveAttribute('aria-selected', 'true');
  }
});

test.describe('keyboard navigation', () => {
  // The arrow-key model is scoped to the focused tablist, so drive whichever
  // bar this project actually shows.
  const focusedId = page => page.evaluate(() => document.activeElement?.dataset?.tab);

  test('arrow keys move through the tablist and wrap', async ({ page }) => {
    const { sel, order } = await visibleBar(page);
    await page.click(`${sel} [data-tab="${order[0]}"]`);

    await page.keyboard.press('ArrowRight');
    expect(await focusedId(page)).toBe(order[1]);
    await expect(page.locator(`#panel-${order[1]}`)).toBeVisible();

    await page.keyboard.press('ArrowDown');
    expect(await focusedId(page)).toBe(order[2]);

    await page.keyboard.press('ArrowLeft');
    expect(await focusedId(page)).toBe(order[1]);

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedId(page), 'should wrap past the start').toBe(order.at(-1));

    await page.keyboard.press('ArrowRight');
    expect(await focusedId(page), 'should wrap past the end').toBe(order[0]);
  });

  test('Home and End jump to the ends', async ({ page }) => {
    const { sel, order } = await visibleBar(page);
    await page.click(`${sel} [data-tab="${order[2]}"]`);

    await page.keyboard.press('Home');
    expect(await focusedId(page)).toBe(order[0]);

    await page.keyboard.press('End');
    expect(await focusedId(page)).toBe(order.at(-1));
    await expect(page.locator(`#panel-${order.at(-1)}`)).toBeVisible();
  });

  test('roving tabindex leaves one tab stop per bar', async ({ page }) => {
    const stops = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tablist"]')].map(
        bar => [...bar.querySelectorAll('[role="tab"]')].filter(t => t.tabIndex === 0).length
      )
    );
    expect(stops).toEqual([1, 1]);
  });

  test('Tab key steps past the tablist rather than through it', async ({ page }) => {
    const bar = (await page.locator('.tabs').isVisible()) ? '.tabs' : '.bottom-tabs';
    await page.click(`${bar} [data-tab="power"]`);
    await page.keyboard.press('Tab');
    // Focus should have left the tablist entirely, not landed on the next tab.
    const stillInBar = await page.evaluate(
      () => !!document.activeElement?.closest('[role="tablist"]')
    );
    expect(stillInBar).toBe(false);
  });
});

test('no orphan labels', async ({ page }) => {
  const orphans = await page.evaluate(() =>
    [...document.querySelectorAll('label')]
      .filter(l => !l.htmlFor && !l.querySelector('input, select, textarea'))
      .map(l => l.textContent.trim())
  );
  expect(orphans).toEqual([]);
});

test('the warp level group is labelled', async ({ page }) => {
  const group = page.locator('#warpLevelBtns');
  await expect(group).toHaveAttribute('role', 'group');
  const labelId = await group.getAttribute('aria-labelledby');
  await expect(page.locator(`#${labelId}`)).toHaveText('Warp level');
});

test('the warp result note is a live region', async ({ page }) => {
  await expect(page.locator('#warpNote')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#warpNote')).toHaveAttribute('role', 'status');
});

test('decorative icons are hidden from assistive tech', async ({ page }) => {
  const svgs = page.locator('.bottom-tabs svg');
  await expect(svgs).toHaveCount(TABS.length);
  for (let i = 0; i < TABS.length; i++) {
    await expect(svgs.nth(i)).toHaveAttribute('aria-hidden', 'true');
  }
});
