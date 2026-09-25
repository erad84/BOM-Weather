# BOM Weather (Pebble)

7-day Bureau of Meteorology outlook for colour Pebbles, with day details and a looping rain radar. Location comes from phone GPS, or a town you set in the phone settings page.

Data is read from BOM’s public forecast XML and radar PNG feeds (`reg.bom.gov.au`), not by scraping HTML.

## Watches

Builds for Time 2 (Emery), Round 2 (Gabbro), Pebble Time (Basalt), and Time Round (Chalk). Black-and-white Pebbles are not targeted.

Open the app’s settings gear on the phone to switch between Auto GPS and a manual town name.

## Build & ship (pebble-ci)

Routine build/ship runs through GitHub Actions [`.github/workflows/pebble-build.yml`](.github/workflows/pebble-build.yml), which calls reusable [`erad84/pebble-ci@v1`](https://github.com/erad84/pebble-ci). CI uploads a `.pbw` artifact; optional CloudPebble install runs when `PEBBLE_FIREBASE_*` secrets are set and the phone is online.

Prefer CI / `gh workflow run pebble-build` over a local `pebble build` for releases. Shared docs and issues: [erad84/pebble-ci](https://github.com/erad84/pebble-ci) ([README](https://github.com/erad84/pebble-ci#pebble-ci)).

