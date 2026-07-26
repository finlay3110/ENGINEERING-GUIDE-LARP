# UCN Engineering Reference Tool

A quick-reference tool for United Confederation Navy engineering officers, covering power management, thermal limits, warp travel setups, and manual damage control procedures.

This is a fan-made project and is not approved by or affiliated with Bridge Command / The London Space Elevator Limited.

## Features

- **Power Management** — how increasing power allocation affects each ship system (reactor, beams, missiles, manoeuvring, impulse, warp, shields, scanner, cargo docks).
- **Thermal & Power Guide** — coolant required at a given power level, and expected cooling behaviour at each level. Power levels are not capped at 100%; the tool reflects overdrive up to and beyond 230%.
- **Warp Guide** — recommended warp/reactor setup for a given travel distance. Enter a sector count to see the nearest tabled setup(s); if the distance falls between two tabled entries, both bracketing rows are shown. Defaults to the all-distance (∞) setup when no distance is entered.
- **Damage Control** — manual repair locations (OCPs, crystals, destabilisation conduits) for UCS Havock and UCS Takanami, plus a button to open each ship's PDF deck map.

## File structure

```
index.html               Main page (all four tabs)
css/style.css            UCN dark navy theme
js/app.js                Tab switching, warp calculator, damage control data
fonts/                   Exo 2 + Orbitron (WOFF2, with TTF fallback)
assets/                  UCN logo
ship-maps/               HAVOCK_SHIP_MAP.pdf, Takanami_Ship_Map.pdf
scripts/serve.mjs        Dependency-free static server for local preview
tests/                   Playwright suite
playwright.config.mjs    Test config (desktop + phone viewports)
```

## Running it

The site is plain static files with no build step and no runtime
dependencies — opening `index.html` directly works for a quick look. Some
things (font loading, the PDF links) behave more like production over HTTP:

```
npm run serve      # http://localhost:8099
```

## Tests

The tests drive a real browser against the served site. They exist mainly to
pin down the things that are easy to break by accident: WCAG contrast on the
overheat warnings, the keyboard model behind the tab roles, and the warp
calculator's edge cases.

```
npm install
npx playwright install chromium
npm test               # both viewport projects
npm run test:headed    # watch it run
```

The suite runs twice, once at desktop width and once at phone width, because
the layout crosses a 700px breakpoint that swaps the tab bar and restructures
every table.

If your environment already has a Chromium that Playwright didn't download
itself, point `CHROMIUM_PATH` at it to skip the version check:

```
CHROMIUM_PATH=/path/to/chromium npm test
```

## Data source

Power, thermal, and warp figures are community-compiled reference data and are subject to change as ship mechanics are updated. This tool does not generate or export any files — it's read-only reference material.

## Credit

Designed by Lt Fin "Tetra"
