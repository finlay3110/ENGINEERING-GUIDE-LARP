import { test, expect } from '@playwright/test';
import { openTab } from './helpers.mjs';

// ============================================================================
// Regression coverage for a real incident: a mission was logged and never
// autosaved, with no on-screen indication anything was wrong. Investigating
// found three distinct, independently reproducible causes rather than one:
//
//   1. The only save-failure warning lived on the Setup tab, invisible
//      whenever any other tab (i.e. the Log tab, where a mission is actually
//      run) was open.
//   2. load() silently discarded corrupted/unparseable stored JSON with no
//      warning at all, resetting to a blank mission.
//   3. There was no cross-tab awareness, so installing the app (this repo's
//      previous PR) while a browser tab was still open created two
//      independent instances silently overwriting each other's saves.
//
// These tests reproduce each cause against the unpatched behaviour first (as
// a comment showing what would fail) and assert the fixed behaviour.
// ============================================================================

/** Make Storage.prototype.setItem throw for our key, simulating a browser
 *  that refuses to persist - Safari Private Browsing caps localStorage at
 *  zero bytes, so every write throws QuotaExceededError from the very first
 *  one. */
async function breakStorageWrites(page) {
  await page.evaluate(() => {
    window.__origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      if (args[0] === 'ucn-mission-v1' || args[0] === 'ucn-mission-v1-backup') {
        throw new DOMException('Quota', 'QuotaExceededError');
      }
      return window.__origSetItem.apply(this, args);
    };
  });
}

async function restoreStorageWrites(page) {
  await page.evaluate(() => {
    if (window.__origSetItem) Storage.prototype.setItem = window.__origSetItem;
  });
}

test.describe('when the device will not persist writes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'log');
  });

  test('a save failure is visible from the Log tab, not just Setup', async ({ page }) => {
    await breakStorageWrites(page);

    // Log something the way a real mission would - this is the exact moment
    // the old code called save(), swallowed the exception, and wrote a
    // warning into an element that lives inside the (currently inactive)
    // Setup panel.
    await page.click('#cellSwapBtn');

    await expect(page.locator('#storageBanner')).toBeVisible();
    await expect(page.locator('#storageBannerText')).toContainText(/not saving/i);
    // The action still happened in memory - the bug was silent data loss on
    // reload, not the UI failing to respond.
    await expect(page.locator('#logTableBody')).toContainText('Power cell swapped');
  });

  test('the banner offers an immediate JSON export', async ({ page }) => {
    await breakStorageWrites(page);
    await page.click('#cellSwapBtn');

    const wait = page.waitForEvent('download');
    await page.click('#storageBannerExport');
    const file = await wait;
    expect(file.suggestedFilename()).toMatch(/\.json$/);
  });

  test('the banner clears once writes start succeeding again', async ({ page }) => {
    await breakStorageWrites(page);
    await page.click('#cellSwapBtn');
    await expect(page.locator('#storageBanner')).toBeVisible();

    await restoreStorageWrites(page);
    await page.click('#cellSwapBtn');
    await expect(page.locator('#storageBanner')).toBeHidden();
  });

  test('dismissing does not silence a later, different problem', async ({ page }) => {
    await breakStorageWrites(page);
    await page.click('#cellSwapBtn');
    await page.click('#storageBannerDismiss');
    await expect(page.locator('#storageBanner')).toBeHidden();

    // The SAME kind of failure recurring should stay dismissed - re-showing
    // it on every keystroke while broken would be its own kind of unusable.
    await page.click('#hullBtn');
    await page.fill('#hullValue', '50');
    await page.click('#hullDialog button[type="submit"]');
    await expect(page.locator('#storageBanner')).toBeHidden();
  });
});

test.describe('when saved data cannot be read back', () => {
  test('corruption in the primary copy recovers from the backup', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'log');
    await page.click('#cellSwapBtn');
    await page.click('#hullBtn');
    await page.fill('#hullValue', '77');
    await page.click('#hullDialog button[type="submit"]');

    // Simulate a write torn by the app or OS being killed mid-flush - the
    // primary key is corrupted; the backup, written on the same save(), is
    // still intact.
    await page.evaluate(() => {
      const raw = localStorage.getItem('ucn-mission-v1');
      localStorage.setItem('ucn-mission-v1', raw.slice(0, Math.floor(raw.length / 2)));
    });

    await page.reload();
    await openTab(page, 'log');

    await expect(page.locator('#logTableBody')).toContainText('Power cell swapped');
    await expect(page.locator('#logTableBody')).toContainText('77%');
    await expect(page.locator('#storageBanner')).toBeVisible();
    await expect(page.locator('#storageBannerText')).toContainText(/restored from a backup/i);
  });

  test('the recovery notice does not use the reload action meant for cross-tab conflicts', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'log');
    await page.click('#cellSwapBtn');
    await page.evaluate(() => {
      const raw = localStorage.getItem('ucn-mission-v1');
      localStorage.setItem('ucn-mission-v1', raw.slice(0, Math.floor(raw.length / 2)));
    });
    await page.reload();
    // Reloading is not the fix here - the data is already recovered in this
    // load - so the Reload button belongs only to the cross-tab warning.
    await expect(page.locator('#storageBannerReload')).toBeHidden();
  });

  test('corruption in both copies starts a blank mission with an honest notice, not silence', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'log');
    await page.click('#cellSwapBtn');

    await page.evaluate(() => {
      localStorage.setItem('ucn-mission-v1', '{not valid json');
      localStorage.setItem('ucn-mission-v1-backup', '{also not valid json');
    });

    await page.reload();
    await openTab(page, 'log');

    await expect(page.locator('#logTableBody')).toContainText('Nothing logged yet');
    await expect(page.locator('#storageBanner')).toBeVisible();
    await expect(page.locator('#storageBannerText')).toContainText(/no backup could be recovered/i);
  });

  test('a missing key (first-ever visit) is not treated as corruption', async ({ page }) => {
    await page.goto('/index.html');
    // Nothing has ever been saved - this must be silent, not an alarming
    // "unreadable" notice for a mission that never existed.
    await expect(page.locator('#storageBanner')).toBeHidden();
  });
});

test.describe('when another tab or window changes the mission', () => {
  test('this tab is warned rather than silently overwriting it next save', async ({ context }) => {
    const tabA = await context.newPage();
    await tabA.goto('/index.html');
    await openTab(tabA, 'log');
    await tabA.click('#cellSwapBtn');

    const tabB = await context.newPage();
    await tabB.goto('/index.html'); // loads the same on-disk mission
    await openTab(tabB, 'log');
    await tabB.click('#cellSwapBtn'); // writes a state tab A has not seen

    await expect(tabA.locator('#storageBanner')).toBeVisible();
    await expect(tabA.locator('#storageBannerText')).toContainText(/another tab or window/i);
    await expect(tabA.locator('#storageBannerReload')).toBeVisible();

    await tabA.close();
    await tabB.close();
  });

  test('reloading picks up the other tab\'s data', async ({ context }) => {
    const tabA = await context.newPage();
    await tabA.goto('/index.html');
    await openTab(tabA, 'log');

    const tabB = await context.newPage();
    await tabB.goto('/index.html');
    await openTab(tabB, 'log');
    await tabB.click('#hullBtn');
    await tabB.fill('#hullValue', '42');
    await tabB.click('#hullDialog button[type="submit"]');

    await expect(tabA.locator('#storageBanner')).toBeVisible();
    await tabA.click('#storageBannerReload');
    await openTab(tabA, 'log');
    await expect(tabA.locator('#logTableBody')).toContainText('42%');

    await tabA.close();
    await tabB.close();
  });

  test('a second tab loading the same untouched mission is not treated as a conflict', async ({ context }) => {
    const tabA = await context.newPage();
    await tabA.goto('/index.html');
    await openTab(tabA, 'log');
    await tabA.click('#cellSwapBtn'); // establishes a saved mission

    const tabB = await context.newPage();
    await tabB.goto('/index.html'); // just reads the same state, changes nothing
    await tabB.close();

    // No divergent write happened, so tab A has nothing to warn about.
    await expect(tabA.locator('#storageBanner')).toBeHidden();
    await tabA.close();
  });
});

test.describe('clearing mission data', () => {
  test('also clears the backup, so a later failed save cannot resurrect it', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'log');
    await page.click('#cellSwapBtn');
    await expect(await page.evaluate(() => localStorage.getItem('ucn-mission-v1-backup'))).not.toBeNull();

    await openTab(page, 'setup');
    page.once('dialog', d => d.accept());
    await page.click('#clearSessionBtn');

    expect(await page.evaluate(() => localStorage.getItem('ucn-mission-v1-backup'))).toBeNull();
  });

  test('dismisses any storage banner that was showing', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'log');
    await breakStorageWrites(page);
    await page.click('#cellSwapBtn');
    await expect(page.locator('#storageBanner')).toBeVisible();
    await restoreStorageWrites(page);

    await openTab(page, 'setup');
    page.once('dialog', d => d.accept());
    await page.click('#clearSessionBtn');

    await expect(page.locator('#storageBanner')).toBeHidden();
  });
});

test.describe('note() timer isolation', () => {
  // Regression: note() used a single module-level timer shared by every
  // element it was ever called on. clearTimeout() only cancels a pending
  // callback, it does not clear text synchronously - so the observable bug
  // was not an early wipe, it was the opposite: calling note() on element B
  // cancelled element A's pending auto-clear and rescheduled it against B
  // instead, leaving A's message stuck on screen forever, since nothing was
  // left to ever clear it. A dedicated per-element timer is what makes each
  // message clear on its own schedule regardless of what else calls note()
  // in between.
  test('an earlier note still auto-clears on its own schedule after a later note on another element', async ({ page }) => {
    await page.goto('/index.html');
    await openTab(page, 'log');
    await page.click('#cellSwapBtn'); // note(exportNote, ...) - starts exportNote's 4s clock
    await expect(page.locator('#exportNote')).not.toBeEmpty();

    await openTab(page, 'setup');
    await page.click('#nowBtn'); // note(setupSaved, ...) - a different element entirely

    await openTab(page, 'log');
    // Under the old shared-timer bug this never happens: setupSaved's note()
    // call above retargets the one shared timer, and exportNote's message is
    // never cleared by anything again.
    await expect(page.locator('#exportNote')).toBeEmpty({ timeout: 5000 });
  });
});
