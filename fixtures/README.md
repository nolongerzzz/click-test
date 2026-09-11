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

Two files here are exceptions to that rule:

**`self-test.json`** is regenerated from the demo by `npm run self-test` on
every run, so it is an output, not something to edit.

**`negative-controls.json`** is the one fixture that *is* hand-written, and it
is meant to contain failures. Every entry is built to grade `fail` or `miss`
on purpose and declares the grade it must produce in an `expect` field; replay
passes an entry only when the actual grade equals that. It exists because every
other entry in this folder is a pass case, so a grading rule that had become
too permissive would show green everywhere.

If an entry there reports `BROKEN`, something in `src/grade.js` changed — **do
not "fix" it by editing the expected/camera/click data until it passes.** That
would delete the test. The file repeats this warning in a `READ_THIS_FIRST`
field, and every entry carries a `note` explaining what it covers.

Each recorded `camera` includes `fov`/`aspect` alongside position and
orientation. Replay restores all of them, because the same NDC click resolves
to a different ray under a different projection — a fixture replayed at another
viewport size would otherwise silently raycast somewhere else.
