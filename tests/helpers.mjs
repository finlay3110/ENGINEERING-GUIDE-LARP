import { expect } from '@playwright/test';

/**
 * Click a tab in whichever bar is currently visible. Below 700px the top tab
 * strip is replaced by the fixed bottom bar, so tests that just want to be on
 * a given panel shouldn't have to care which project they're running under.
 */
export async function openTab(page, name) {
  const top = page.locator(`.tabs [data-tab="${name}"]`);
  const bottom = page.locator(`.bottom-tabs [data-tab="${name}"]`);
  await (await top.isVisible() ? top : bottom).click();
  await expect(page.locator(`#panel-${name}`)).toBeVisible();
}

/** Relative luminance per WCAG 2.x. */
function luminance([r, g, b]) {
  const f = c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two [r,g,b] triples, rounded to 2dp. */
export function contrastRatio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function parseRgb(value) {
  const nums = value.match(/[\d.]+/g);
  if (!nums) return null;
  const [r, g, b, a] = nums.map(Number);
  return { rgb: [r, g, b], alpha: a === undefined ? 1 : a };
}

/**
 * Resolve the colour a user actually sees for `selector`, walking ancestors to
 * find the first opaque background and compositing any translucent layers
 * (highlight rows and zebra striping) on top of it. Reading background-color
 * off the element alone would report `transparent` and silently pass.
 */
export async function renderedColours(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element for selector: ${sel}`);

    const layers = [];
    let base = [255, 255, 255];
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = bg.match(/[\d.]+/g);
      if (!m) continue;
      const [r, g, b, a = 1] = m.map(Number);
      if (a === 0) continue;
      if (a === 1) { base = [r, g, b]; break; }
      layers.unshift([r, g, b, a]);
    }
    // Composite translucent layers bottom-up onto the opaque base.
    const bg = layers.reduce(
      (acc, [r, g, b, a]) => acc.map((c, i) => c * (1 - a) + [r, g, b][i] * a),
      base
    );

    return {
      color: getComputedStyle(el).color.match(/[\d.]+/g).slice(0, 3).map(Number),
      background: bg.map(Math.round),
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      fontWeight: getComputedStyle(el).fontWeight,
    };
  }, selector);
}
