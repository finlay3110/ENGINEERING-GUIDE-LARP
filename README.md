# UCN Engineering Reference Tool

A quick-reference tool for United Confederation Navy engineering officers, covering power management, thermal limits, warp travel setups, and manual damage control procedures.

This is a fan-made project and is not approved by or affiliated with Bridge Command / The London Space Elevator Limited.

## Features

- **Setup** — name, rank, date and time, mission name, mission type and ship,
  plus a checkbox per section. Power Management shows the power, thermal and
  warp tabs; Damage Control shows the damage tab and the repair buttons on the
  log. Setup and the Action Log are always available. **New mission** clears
  the mission and its log but keeps the operator and their settings, ready for
  the next watch; **Clear mission data** wipes everything.
- **Action Log** — records manual repairs with a start and end time. Manual
  repair leads to OCP, crystals, conduits or reactor; OCP and crystals then
  list that ship's locations, and conduits are multi-select because they
  usually drop in groups. Separate one-tap buttons log a power cell swap
  and a hull integrity reading, both of which are moments rather than timed
  repairs. Running totals for OCP, crystal and conduit repairs and power cell
  swaps, plus spare OCPs counting down from five. Reactor repairs and hull
  readings are recorded in the log and the exports without a counter of their
  own. Exports to PDF or JSON, with a handover prompt describing the JSON to
  another app.

- **Power Management** — how increasing power allocation affects each ship system (reactor, beams, missiles, manoeuvring, impulse, warp, shields, scanner, cargo docks).
- **Thermal & Power Guide** — coolant required at a given power level, and expected cooling behaviour at each level. Power levels are not capped at 100%; the tool reflects overdrive up to and beyond 230%.
- **Warp Guide** — recommended warp/reactor setup for a given travel distance. Enter a sector count to see the nearest tabled setup(s); if the distance falls between two tabled entries, both bracketing rows are shown. Defaults to the all-distance (∞) setup when no distance is entered.
- **Damage Control** — manual repair locations (OCPs, crystals, destabilisation conduits) for UCS Havock and UCS Takanami, plus a button to open each ship's PDF deck map.

## File structure

```
index.html               Main page (all six tabs)
css/style.css            UCN dark navy theme
js/app.js                Tab switching, warp calculator, damage control data
js/mission.js            Setup, action log, PDF/JSON export
js/vendor/               jsPDF, vendored so exports work offline
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

Two environment variables adjust how the suite runs:

```
CHROMIUM_PATH=/path/to/chromium npm test    # use an existing browser binary
BASE_URL=https://example.netlify.app npm test   # test a deployed site
```

`CHROMIUM_PATH` skips Playwright's browser-revision check, for environments
that ship their own Chromium. `BASE_URL` runs the tests against a deployed
URL — a Netlify deploy preview, for instance — instead of starting a local
server, which is a way to check that what actually shipped behaves like the
working tree.

## Mission data

Setup details and the action log are held in `localStorage` on the device that
recorded them. They are not uploaded anywhere and are not shared between
devices or browsers. Clearing site data, or the **Clear mission data** button,
removes them. Export before you finish if you need to keep a mission.

## Data source

Power, thermal, and warp figures are community-compiled reference data and are subject to change as ship mechanics are updated. The reference tables are read-only. The Action Log is the only part that records anything, and it exports only when you ask it to.

## Credit

Designed by Lt Fin "Tetra"
