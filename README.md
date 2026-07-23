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
index.html              Main page (all four tabs)
css/style.css            UCN dark navy theme
js/app.js                Tab switching, warp calculator, damage control data
fonts/                   Exo 2 + Orbitron (embedded via @font-face)
assets/                  UCN logo
ship-maps/               HAVOCK_SHIP_MAP.pdf, Takanami_Ship_Map.pdf
```

## Data source

Power, thermal, and warp figures are community-compiled reference data and are subject to change as ship mechanics are updated. This tool does not generate or export any files — it's read-only reference material.

## Credit

Designed by Lt Fin "Tetra"
