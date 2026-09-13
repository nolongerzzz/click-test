# Nest Paint + Soften driver

Presses live Nest functions and grades what Nest reports, so a Paint/Soften
regression is caught without anyone sitting through Arm.

Capture swallows the click that the interactive harness needs, so Paint and
Soften never bake under it. This driver goes the other way: it does not want
a canvas click at all. It clicks **Nest's own buttons** and calls **Nest's own
exported functions**, and the only thing it grades is the text Nest writes
into `#status`.

## The driven sequence

Exactly this, on the fixture already on the plate:

1. **Paint on** — clicks `#btn-mask-paint` (Nest's toggle, not a re-implementation).
2. **All six outer hull faces excluded.** One axis view per face; for each,
   the camera is moved through the host contract's `setCameraState`, the
   piece's silhouette is swept centre-outwards, and the first sample that
   resolves to a *flat, outer* face on the axis that view is looking at is
   handed to `window.nsoMaskToggleAt`. Mouth and pocket faces are left
   unpainted — a sample whose region is `pocket`, or whose face comes back
   recessed, is skipped, not painted.
3. **Paint off** — clicks `#btn-mask-paint` again.
4. **Full wrap on** — `#chk-full-wrap`, read back through `window.getFullWrap()`.
5. **One press of `#btn-soften`.** No Arm. No canvas click. No second press.
6. **Grade `#status`** with `nest-status-grade.js`.

| grade | what it means |
| --- | --- |
| `pass` | the press baked — a wrap radius / face count is in the line (`Round wrap R 0.50 on a pocket piece - 5 of 11 faces baked …`) |
| `fail` | the press armed (`Soften (round): click a face`), cancelled (`Soften cancelled`), or was refused (`Wrap failed …`, `Wrap found no pocket …`) |
| `miss` | a prerequisite was absent, the fixture is not a six-face hull plus pocket, or the wording is one the rule does not know |

## Running it

```
https://<nest>/?cth=drive
```

and, once the page is up, a re-run from the console without a reload:

```js
await window.__CTH_DRIVE__.run();   // resolves to the report
window.__CTH_DRIVE_REPORT__;        // the last report
```

The result is written into the note line of the **existing** CTH card — no new
overlay, no new layout. Arm stays where it is for manual fallback.

## Files added (all in this repo)

```
driver/nest-paint-soften-drive.js   the driver
driver/nest-status-grade.js         the #status -> pass/fail rule (pure, no DOM)
driver/nest-status-grade.test.js    node test: 31 real Nest status lines
driver/README.md                    this file
```

`npm run test:drive-grade` runs the status test. It needs no browser and no
Nest — the rule is pure, which is the point: the browser driver and the test
import the same implementation, so a wording rule cannot drift between them.

## The `window` names it calls

**Every one of these is already on the page.** The driver adds no expose line
and needs none.

| name | where it comes from | used for |
| --- | --- | --- |
| `window.state` | `app-cth-expose.js` | `placed`, `models`, `camera`, `raycaster`, `modelGroup`, `renderer`, `maskPaint`, `softenArmed`, `nsoWrapBusy` |
| `window.THREE` | `app-cth-expose.js` | `Vector2/3`, `Box3`, `Matrix4`, `Quaternion` for the six axis views |
| `window.__CTH_HOST__.raycastAtScreenPoint` | `cth/three-adapter.js` | the aim ray, and the hull/pocket **region** |
| `window.__CTH_HOST__.getCameraState` / `.setCameraState` | `cth/three-adapter.js` | move to each axis view, restore the owner's pose |
| `window.__CTH_OVERLAY__.setNote` | `cth/cth-live.js` | the result line in the existing card |
| `window.nsoMaskToggleAt(model, mesh, hit)` | `app-mask.js` | **exclude a face** — the same call the paint's own pointer handler makes |
| `window.nsoMaskCount(model)` | `app-mask.js` | how many faces are excluded |
| `window.nsoMaskFaces(model)` | `app-mask.js` | read back the axis+side of every painted face — the six-of-six gate |
| `window.nsoMaskIsExcludedPick(...)` | `app-mask.js` | confirm the face this pick named is now excluded |
| `window.nsoMaskRepaint()` | `app-mask.js` | the yellow, and its triangle count |
| `window.nsoFaceFromHit(model, mesh, hit)` | `app-finish.js` | which face a hit named — flat? outer? which axis and side? |
| `window.nsoWrapAllReady(model)` | `app-finish.js` (top-level fn) | Nest's own "this piece needs no face picked" — the pocket gate |
| `window.getFullWrap()` | `app-finish.js` (top-level fn) | read back that Full wrap is really on |
| `window.getActiveModel()` | `app-cut.js` (top-level fn) | confirm Soften will act on the fixture |
| `window.selectPlaced(index)` | `app-sel-outline.js` | make the fixture the active piece |

DOM it clicks or reads: `#btn-mask-paint`, `#btn-soften`, `#chk-full-wrap`,
`#status`, `#adjust-status`. Nothing else.

### If any of those ever stop being reachable

`nsoWrapAllReady`, `getFullWrap` and `getActiveModel` are **implicit** globals
— they are plain top-level `function` declarations in classic (non-module)
scripts, so the browser puts them on `window` for free. That is the only thing
holding them there. If `app-finish.js` or `app-cut.js` is ever wrapped in an
IIFE or converted to a module, these three lines are what Nest would have to
add, and nothing else:

```js
window.nsoWrapAllReady = nsoWrapAllReady;   // app-finish.js
window.getFullWrap     = getFullWrap;       // app-finish.js
window.getActiveModel  = getActiveModel;    // app-cut.js
```

The driver checks all of them up front and, if any is absent, records a
`miss` naming the exact missing name and stops — it does not click the canvas
to fake a bake.

## The one call site Nest needs

The driver is a click-test file. To reach the page it has to be vendored into
`cth/` the way `grade.js`, `harness.js` and `three-adapter.js` already are,
and `?cth=drive` has to route to it. That is **one mode branch in
`app-cth.js`** — no Nest tool is touched, and Finish, Split, Join and the HUD
are not in it.

Copy `driver/nest-paint-soften-drive.js` and `driver/nest-status-grade.js`
into `cth/`, then in `app-cth.js`:

```js
// in cthMode(), beside the 'finish' line:
if (s === 'drive') return 'drive';

// in boot(), the spec picker already there — drive reuses the finish batch
// so the existing card and its Arm button are unchanged:
const specPath = (mode === 'finish' || mode === 'drive')
  ? './cth/nest-finish-first-batch.js?v=cth10'
  : './cth/nest-plate-first-batch.js?v=cth10';

// after live.mountLiveHarness({...}) has returned:
if (mode === 'drive') {
  const drive = await import('./cth/nest-paint-soften-drive.js?v=cth10');
  const grade = await import('./cth/grade.js?v=cth10');
  drive.mountNestDrive({ gradeHit: grade.gradeHit, overlay: window.__CTH_OVERLAY__ });
}
```

`cth/overlay.js`'s `shouldMount()` already accepts the flag by value; add
`'drive'` to its list beside `'finish'` so the card mounts in drive mode too.

Passing `gradeHit` is optional — without it the driver falls back to its own
copy of the alias-and-region rule. Passing it means the alias rule
(`box_hull` matching `box_hull_80x40x20-2`) has exactly one implementation on
the page.

**Pull the plug is unchanged.** Delete `app-cth.js`, `app-cth-expose.js`,
`cth/` and the two script tags and the driver goes with them. It adds nothing
to Finish, no wrapper on a Nest tool, and no state a Nest tool reads.

## What it deliberately does not do

- **No canvas clicks.** Not for Paint, not for Soften. The one thing it must
  never do is manufacture the click it is testing for.
- **No second picker.** The aim ray and the hull/pocket region are the host
  contract's. The intersection handed to `nsoMaskToggleAt` comes from Nest's
  own `state.raycaster` over `state.modelGroup` — the same raycaster,
  the same object list and the same filter as `onCanvasPointerDown` and
  app-mask's `hitFace`, so the hit has the shape a real click would produce.
  If a host ever exposes `__CTH_HOST__.rawHitAtScreenPoint(point)`, the driver
  uses that instead and there is one ray in the page.
- **No second fixture.** `CTH_fixture` / `box_hull` only. No USB, no
  `box_bit`, no `box_closed`.
- **No new overlay.** It writes one line into the card that is already there.
- **No Playwright.** The replay path drives `__CTH_HOST__` only; it has no
  reach into Paint or Soften, so pointing it here would be a rewrite, not a
  reuse.

## Limits worth knowing

- **It leaves the bake in place.** A pass means geometry changed. The six
  painted faces and the wrap are both on Nest's undo stack (one step for the
  wrap, one per painted face), but the driver does not undo them for you.
- **A pass is Nest's word, not a measurement.** The grade is the `#status`
  line. Confirming the mesh is what it should be is the STL checker's job,
  not this driver's.
- **The sweep is 7x7 per face, inset 18%.** A hull face whose visible area is
  smaller than that grid's spacing — a very thin wall seen edge-on — can be
  missed, and that is reported as `hull-face-not-found` on the named view
  rather than silently painted elsewhere.
