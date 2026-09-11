# click-test-harness

A config-driven test harness for the class of bugs every raycasting/picking
3D web app runs into: wrong face, wrong plane, wrong object through an
overlap, wrong placement point, wrong result after a rotation. Walk through
a defined set of click tests, record exactly what happened, replay those
recordings headlessly in CI, and get an issue filed automatically when
something regresses.

## How the pieces fit together

```
src/harness.js           -- engine-agnostic core. Knows nothing about Three.js.
src/grade.js             -- the one grading rule, shared by harness + replay.
src/three-adapter.js     -- implements the "host contract" for Three.js apps.
src/pointer-capture.js   -- takes one click back from a host's own drag tooling.
src/overlay.js           -- the live pass/fail panel (shadow DOM, host-agnostic).
src/cth-live.js          -- one call that wires all of the above into a real app.
src/issue-button.js      -- Tier 1: prefilled GitHub issue URL, no token needed.
replay/record.js         -- drives a page with real clicks to produce a fixture.
replay/replay.js         -- Tier 2: headless CI replay via Playwright.
replay/self-test.js      -- serves the demo, then runs record + replay against it.
replay/github-issues.js  -- Tier 2: auto-files/comments on issues, with dedupe.
demo/index.html          -- worked example wiring all of the above together.
```

### The "listener" — what it's actually for

`three-adapter.js` ends by doing this:

```js
window.__CTH_HOST__ = { getCameraState, setCameraState, raycastAtScreenPoint };
```

That's the whole trick. Your app, running normally in a real browser tab,
exposes three small functions on `window`. Two very different consumers can
then talk to those same functions:

1. **The interactive harness**, running in the same page, calling
   `raycastAtScreenPoint` every time you tap a marker.
2. **The headless replay script**, running in a *separate* Node process,
   driving a headless browser that has your app loaded. It calls the exact
   same functions from the outside — `setCameraState(...)` to put the camera
   back where it was during a real recorded click, then
   `raycastAtScreenPoint(...)` to ask "what would this click hit right now?"

Nothing is scraped or guessed. The replay script isn't simulating DOM clicks
against a WebGL canvas (notoriously unreliable) — it's just calling your
app's real raycast function with the exact inputs from a real recorded
session, and checking the output hasn't changed. That's the whole mechanism
that turns a manual click into a permanent regression test.

## Wiring it into your app

1. Add `raycastables` — an array of your `THREE.Object3D`s, each with `.name`
   set to a stable id you'll reference in test specs.
2. Call `createThreeHostAdapter({ THREE, scene, camera, raycastables })` once,
   anywhere after your scene/camera exist.
3. Write test specs (plain JSON, see `demo/index.html` for the shape) and
   pass them to `createClickTestHarness({ container, host, tests })`.
4. Call `harness.start()`.

That's the entire integration. The adapter's `window.__CTH_HOST__` hook is
what makes step 5 (CI replay) possible without touching your app again.

## Two tiers of issue filing

**Tier 1 — no token, works anywhere, including a public hosted demo.**
`src/issue-button.js` builds a `github.com/OWNER/REPO/issues/new?...` URL
with the failure's camera/click/hit data prefilled in the body, and opens it.
The person reviews and hits submit. Nobody's credentials are involved, so
it's safe to ship to strangers using a public version of this tool.

**Tier 2 — fully automatic, for your own CI.**
`.github/workflows/click-tests.yml` runs `replay/replay.js` against your
built app on every push/PR, using the GitHub Actions built-in `GITHUB_TOKEN`
(no secret to configure). On failure, `replay/github-issues.js` searches for
an existing open issue with a hidden `<!-- click-test:{testId} -->` tag —
the same tag Tier 1 embeds — and either comments "still failing" on it or
files a new issue. Re-running CI on a known failure never spams duplicates.

Swap the `Build app` / `Serve app` steps in the workflow for however your
actual app builds and serves — this toolkit's own `demo/` doesn't need a
bundler, but your real app almost certainly does.

## Try the demo

```
npm install
npm run demo      # serves the repo root on :5174
```

Then open **<http://localhost:5174/demo/>**.

The server has to cover the repo root, not just `demo/`: `demo/index.html`
imports `../src/*.js`, so serving the `demo` folder alone 404s on every module.

Three.js comes from the jsdelivr import map, so the demo needs no bundler. If
the CDN is unreachable (offline, locked-down CI egress, a corporate proxy) the
page falls back to the `three` copy in `node_modules` — pinned to the same
0.160.0 — so a third-party outage can't turn the self-test red.

Work through the 7 example tests (built on stand-in
geometry — the same categories from the original brief: straight-on face,
shallow-angle face, edge, occlusion, thin feature, open placement, and a
post-rotation face), export the results, and try:

```
APP_URL=http://localhost:5174/demo/ node replay/replay.js fixtures/your-export.json
```

`APP_URL` must include the path your app is served at, not just the origin.

## Running the harness on itself

`.github/workflows/self-test.yml` tests the toolkit against its own demo —
no external app, no human clicking anything:

```
npm run self-test
```

That one command starts a static server on the repo root, runs both steps
against it, and shuts the server down again — nothing to start beforehand.
(Set `APP_URL` to point it at a server you're already running instead.)

It runs two different mechanisms back to back, on purpose:

1. **`replay/record.js`** drives the demo like a real user would — it reads
   each marker's actual 3D position, projects it through the real camera to
   a screen pixel, and dispatches a real click there. This is what makes the
   fixture trustworthy: it isn't hand-typed, it's a real interaction. It also
   orbits the camera by a fixed amount between tests, so each entry records a
   *different* camera pose. That matters: if every entry shared the page's
   default pose, replay would still pass with `setCameraState` completely
   broken — the one path it exists to protect.
2. **`replay/replay.js`** then replays that same fixture through the direct
   `window.__CTH_HOST__` hooks and checks every result still matches.
3. **`fixtures/negative-controls.json`** is replayed last, to check the grader
   still *rejects* what it should. Every other fixture entry in this repo is a
   pass case, so without this a grading rule that had gone too permissive would
   report green. Each entry there declares the grade it must produce via an
   `expect` field (`'pass'` when absent), and replay treats an entry as OK only
   when its actual grade equals that. **They are intentional — a `BROKEN` line
   from one of them means `src/grade.js` regressed, not that the fixture needs
   fixing.**

If step 1 can't complete every test, or step 2 finds a mismatch, the bug is
in `src/harness.js` or `src/three-adapter.js` — this workflow is what
protects those two files, independent of whatever app you've wired the
harness into elsewhere.

## Running a live batch inside a real app

The demo drives itself. A live batch is different: a person aims at features of
a real model in the real app, and needs to see pass/fail per aim as they go.

**Integration is one import and one call.** It is inert unless the URL carries
the flag, so shipping the call costs the normal app nothing:

```js
import { mountLiveHarness } from '<path>/click-test/src/cth-live.js';
import { MY_AIMS } from '<path>/click-test/specs/my-aims.js';

mountLiveHarness({ THREE, scene, camera, renderer, raycastables, tests: MY_AIMS });
// inert on the normal URL; active on ?cth=1
```

`raycastables` is the array of pickable `Object3D`s, each with `.name` set to
the id used in a spec's `accept.objectId`. Nothing else about the host changes.

### Arm, then click — and why

A host that moves the model on `pointerdown` will eat the pick before the
harness ever grades it: the model slides, the pointer travels past the drag
threshold, and the gesture is discarded as a drag. The symptom is a host status
like "Moved model #1" with zero face hits.

So live batches run in `pointerMode: 'capture'`, which listens in the **capture
phase on `window`** — strictly ahead of any listener on the canvas, whatever
order they were registered in — and calls `stopImmediatePropagation()`. The
host's handler never runs.

That is armed **per pick**, not permanently, because the tester still needs to
orbit and tip the part between aims. Press **Arm pick**, click once, and the
harness takes exactly that one gesture; everything before and after is the
host's as usual. An armed gesture that moves too far is reported as an ignored
drag rather than graded.

`replay/capture-check.js` proves this against a host that deliberately steals
pointerdown: unarmed the model slides and nothing is graded (so the check is
testing something real), armed the model does not move and the pick grades.

### Aim-by-eye specs

A live spec usually has no `target`: the tester aims at a described feature
rather than a rendered marker, which avoids needing local normals and
half-extents for the real geometry. Only `accept` is needed to grade. See
`specs/nest-plate-first-batch.js`.

### Testing the flag locally

`npm run demo` uses `serve`, whose `cleanUrls` 301-redirects `/x.html` to `/x`
**and drops the query string** — so `?cth=1` silently vanishes and the overlay
never mounts. Use the extensionless URL locally:

```
http://localhost:5174/demo/live-overlay?cth=1      # works
http://localhost:5174/demo/live-overlay.html?cth=1 # query lost to the redirect
```

GitHub Pages serves `.html` directly and keeps the query, so a deployed
`?cth=1` URL is unaffected. (Setting `cleanUrls:false` in a `serve.json` fixes
the redirect but breaks directory-index resolution, so it is not worth it.)

## Known limitations

Deliberately not addressed, recorded here so they aren't silently forgotten:

- **`zoom` and `fov` are captured and restored but never exercised.**
  `getCameraState` records both and `setCameraState` restores them, yet nothing
  in the demo varies either — its wheel handler changes the orbit *radius*
  (moving the camera) rather than touching `camera.zoom`, and `fov` is fixed at
  45. So both fields are constant across every recorded fixture, and a
  regression that dropped them from the restore path would not be caught. The
  sibling field `aspect` *is* covered, because replay sizes its viewport from
  the fixture and so genuinely differs from the live page. Anyone wiring in an
  app with a zoom or FOV control should add a fixture that varies them.

- **"Engine-agnostic core" is a claim, not a tested property.**
  `src/harness.js` is written to talk only to the host-adapter contract, but
  `src/three-adapter.js` is the only implementation that exists, so nothing
  proves the core has not quietly grown a Three.js assumption. The first
  non-Three adapter (Babylon, native canvas, a stub) is what would establish
  it — and is also the natural place to find out.

## Making a test spec

```js
{
  id: 'top-face',
  title: 'Pick a face straight on',
  instruction: 'Tap the marker on top of the cube.',
  target:  { objectId: 'cubeA', kind: 'face', normal: [0,1,0] },
  accept:  { objectId: 'cubeA', normals: [[0,1,0]] }
}
```

### `accept.normalTolerance` (optional)

A hit's normal counts as matching an accepted normal when the dot product of
the two is **strictly greater than** `accept.normalTolerance`, which defaults
to `0.95` (roughly 18 degrees of slop). Set it per test to loosen or tighten
that:

```js
accept: { objectId: 'bracket', normals: [[0,1,0]], normalTolerance: 0.8 }
```

The default suits flat, axis-aligned faces, where the normal at the click
point is exactly the nominal one. Loosen it (towards `0`) for curved or
tessellated geometry, where the triangle you happen to hit can sit some way
off the nominal direction and a strict threshold would reject a correct pick.
Tighten it (towards `1`) when a test needs to distinguish two nearly parallel
faces.

The field lives on `accept`, so it is carried into recordings as
`expected.normalTolerance` and honoured identically on replay — one rule, in
`src/grade.js`, shared by the live harness and the headless replay.

`normal` is always in the object's **local** space — that's what makes the
"pick a face after rotation" test category work: the local normal for "the
left face" doesn't change just because the mesh's world rotation did.

`kind` is one of `face`, `edge`, `occlusion`, `placement` — it only affects
how the marker is positioned (`three-adapter.js`); grading always just
compares `objectId` (and `normals`, if you supplied them) against what the
raycast actually returned.

One caveat for `occlusion` targets: put `worldPoint` **on the near object's
surface**, not at a point interior to both objects. An interior point has no
well-defined "front" object — the sight line enters whichever solid it reaches
first, so the correct answer changes with the camera and the test grades itself
differently from different viewpoints.
