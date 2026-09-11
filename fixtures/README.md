# Fixtures

This folder holds exported click-test results (JSON) that `replay/replay.js`
re-runs headlessly in CI.

**Don't hand-write these.** Run the demo (or your real app with the harness
wired in), work through the tests, hit **Export results**, and drop the
downloaded file here — e.g. `fixtures/nest-optimizer-core.json`.

Each fixture is a self-contained recording of real camera positions and real
screen clicks. `replay.js` replays every `.json` file in this folder against
`APP_URL` on every push, so commit a new fixture whenever you add a test case
worth protecting against regressions.

`self-test.json` is the exception: `npm run self-test` regenerates it from the
demo on every run, so it is an output, not something to edit.

Each recorded `camera` includes `fov`/`aspect` alongside position and
orientation. Replay restores all of them, because the same NDC click resolves
to a different ray under a different projection — a fixture replayed at another
viewport size would otherwise silently raycast somewhere else.
