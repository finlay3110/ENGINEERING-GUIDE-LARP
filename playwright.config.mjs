import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT) || 8099;

// Point BASE_URL at a deployed site (a Netlify deploy preview, say) to run the
// suite against that instead of a local server. Unset, the tests spin up
// scripts/serve.mjs and run against the working tree.
const BASE_URL = process.env.BASE_URL;

// Sandboxes and CI images sometimes ship a Chromium build that doesn't match
// the revision this Playwright version expects. Point CHROMIUM_PATH at that
// binary to use it instead of the downloaded one; unset, everything behaves
// normally and `npx playwright install chromium` is all that's needed.
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL || `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    launchOptions,
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    // The layout crosses a 700px breakpoint that swaps the tab bar and
    // restructures every table, so the phone width is a separate run rather
    // than a viewport tweak inside individual tests.
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],

  webServer: BASE_URL
    ? undefined
    : {
        command: 'node scripts/serve.mjs',
        url: `http://localhost:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
      },
});
