/**
 * click-test-harness / Nest Paint + Soften driver
 *
 * Presses live Nest functions and grades what Nest reports. It never
 * dispatches a pointer event at the WebGL canvas: the only clicks it makes
 * are on Nest's own buttons (`#btn-mask-paint`, `#btn-soften`), which is the
 * path a person's click takes once Capture has swallowed theirs.
 *
 * The driven sequence, and nothing else:
 *   1. Paint on          - click `#btn-mask-paint` (Nest's own toggle).
 *   2. Exclude all six outer hull faces of the loaded fixture, each one via
 *      `window.nsoMaskToggleAt(model, mesh, hit)` with a REAL intersection
 *      from Nest's own raycaster. Mouth and pocket faces are left alone.
 *   3. Paint off         - click `#btn-mask-paint` again.
 *   4. Full wrap on      - `#chk-full-wrap`, read back through Nest's
 *                          `window.getFullWrap()`.
 *   5. One press of `#btn-soften`. No Arm. No canvas click.
 *   6. Grade `#status` with driver/nest-status-grade.js.
 *
 * Fail-safe, in the ticket's sense: every prerequisite is checked before
 * anything is touched, and a missing hook, a fixture that is not a six-face
 * hull with a pocket, or a face that will not resolve, all stop the run and
 * are recorded as a `miss`. Nothing is faked to keep the run going.
 *
 * Camera: steps 2 needs to see all six hull faces, so the driver moves the
 * camera through six axis views using the host contract's own
 * `setCameraState`, and restores the pose it started from. All six picks run
 * in one synchronous pass, so OrbitControls never gets a frame in between.
 */

import { gradeNestSoftenStatus } from './nest-status-grade.js';

/* The fixture, and only this fixture. `box_hull` is the catalog piece,
   `CTH_fixture` the exported one; the alias pair is the same one
   cth/nest-finish-first-batch.js already locked. */
export const FIXTURE_ALIASES = ['CTH_fixture', 'box_hull'];

const AXIS_VIEWS = [
  { key: 'x+', dir: [1, 0, 0] },
  { key: 'x-', dir: [-1, 0, 0] },
  { key: 'y+', dir: [0, 1, 0] },
  { key: 'y-', dir: [0, -1, 0] },
  { key: 'z+', dir: [0, 0, 1] },
  { key: 'z-', dir: [0, 0, -1] },
];

/* How far across a face the driver is willing to look for hull. The centre
   of a face is not always hull - on this fixture the pocket mouth is in the
   middle of the x- face - so each view is swept on a grid inside the piece's
   own projected silhouette, centre outwards, and the first sample that
   resolves to a flat outer face on the expected axis wins. */
const SWEEP_STEPS = 7;
const SWEEP_INSET = 0.18;

const SETTLE_POLL_MS = 60;
const DEFAULT_TIMEOUT_MS = 30000;

/* ---------------------------------------------------------------- hooks -- */

/* Everything the driver calls on the page, in one list, so a run that cannot
   proceed says exactly which name is absent instead of throwing. Names marked
   `dom` are Nest's own controls; the rest are live Nest functions and state.
   None of them are added by this driver - see driver/README.md for which are
   already on `window` and which Nest would have to export. */
function hookTable() {
  const w = typeof window !== 'undefined' ? window : {};
  const host = w.__CTH_HOST__ || {};
  const st = w.state;
  return [
    ['window.THREE', () => !!w.THREE],
    ['window.state', () => !!st],
    ['window.state.camera', () => !!(st && st.camera)],
    ['window.state.raycaster', () => !!(st && st.raycaster)],
    ['window.state.modelGroup', () => !!(st && st.modelGroup)],
    ['window.state.renderer.domElement', () => !!(st && st.renderer && st.renderer.domElement)],
    ['window.__CTH_HOST__.raycastAtScreenPoint', () => typeof host.raycastAtScreenPoint === 'function'],
    ['window.__CTH_HOST__.getCameraState', () => typeof host.getCameraState === 'function'],
    ['window.__CTH_HOST__.setCameraState', () => typeof host.setCameraState === 'function'],
    ['window.nsoMaskToggleAt', () => typeof w.nsoMaskToggleAt === 'function'],
    ['window.nsoMaskCount', () => typeof w.nsoMaskCount === 'function'],
    ['window.nsoMaskFaces', () => typeof w.nsoMaskFaces === 'function'],
    ['window.nsoMaskIsExcludedPick', () => typeof w.nsoMaskIsExcludedPick === 'function'],
    ['window.nsoMaskRepaint', () => typeof w.nsoMaskRepaint === 'function'],
    ['window.nsoFaceFromHit', () => typeof w.nsoFaceFromHit === 'function'],
    ['window.nsoWrapAllReady', () => typeof w.nsoWrapAllReady === 'function'],
    ['window.getFullWrap', () => typeof w.getFullWrap === 'function'],
    ['window.getActiveModel', () => typeof w.getActiveModel === 'function'],
    ['window.selectPlaced', () => typeof w.selectPlaced === 'function'],
    ['dom #btn-mask-paint', () => !!document.getElementById('btn-mask-paint')],
    ['dom #btn-soften', () => !!document.getElementById('btn-soften')],
    ['dom #chk-full-wrap', () => !!document.getElementById('chk-full-wrap')],
    ['dom #status', () => !!document.getElementById('status')],
  ];
}

function missingHooks() {
  return hookTable().filter(([, present]) => !present()).map(([name]) => name);
}

/* ------------------------------------------------------------- matching -- */

/* The same alias rule cth/grade.js uses: an exact catalog name, or a catalog
   name the loaded piece extends with a suffix (`box_hull_80x40x20-2` is
   `box_hull`). Pass `opts.gradeHit` to use Nest's vendored cth/grade.js
   instead and this is never called. */
function aliasMatch(wanted, got) {
  if (!wanted || !got) return false;
  return wanted === got || got.indexOf(wanted + '_') === 0;
}

function makeAimTest(gradeHit) {
  if (typeof gradeHit === 'function') {
    const accept = { objectId: FIXTURE_ALIASES.slice(), region: 'hull' };
    return (hit) => gradeHit(accept, hit) === 'pass';
  }
  return (hit) => !!hit && hit.hit === true && hit.region === 'hull' &&
    FIXTURE_ALIASES.some((a) => aliasMatch(a, hit.objectId));
}

/* --------------------------------------------------------------- pieces -- */

/* The catalog name of a placed piece, matched the way the host adapter
   already names what a ray lands on. */
function catalogNameOf(model) {
  return model && model.name ? String(model.name).replace(/\.stl$/i, '') : '';
}

function findFixture() {
  const st = window.state;
  const placed = (st && st.placed) || [];
  const models = (st && st.models) || [];
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (!p || !p.mesh || p.sourceId == null) continue;
    const m = models.find((x) => x && x.id === p.sourceId);
    if (!m) continue;
    const name = catalogNameOf(m);
    if (FIXTURE_ALIASES.some((a) => aliasMatch(a, name))) {
      return { model: m, mesh: p.mesh, placed: p, placedIndex: i, name };
    }
  }
  return null;
}

/* ----------------------------------------------------------------- rays -- */

function ndcPoint(canvas, xNDC, yNDC) {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.width || 1;
  const h = rect.height || canvas.height || 1;
  return {
    xNDC: +xNDC.toFixed(4),
    yNDC: +yNDC.toFixed(4),
    xPix: Math.round(((xNDC + 1) / 2) * w),
    yPix: Math.round(((1 - yNDC) / 2) * h),
    canvasWidth: Math.round(w),
    canvasHeight: Math.round(h),
  };
}

/* Nest's own picker: Nest's raycaster, Nest's modelGroup, Nest's filter.
   `onCanvasPointerDown` and app-mask's `hitFace` do exactly this, which is
   why the intersection handed to `nsoMaskToggleAt` is the same shape a real
   click would have produced. If a host ever exposes a raw pick of its own,
   that is preferred so there is only ever one ray in the page. */
function rawHitAt(point) {
  const host = window.__CTH_HOST__ || {};
  if (typeof host.rawHitAtScreenPoint === 'function') {
    return host.rawHitAtScreenPoint(point) || null;
  }
  const st = window.state;
  const THREE = window.THREE;
  st.camera.updateMatrixWorld(true);
  st.scene && st.scene.updateMatrixWorld(true);
  st.raycaster.setFromCamera(new THREE.Vector2(point.xNDC, point.yNDC), st.camera);
  const hits = st.raycaster.intersectObjects(st.modelGroup.children, true);
  for (let i = 0; i < hits.length; i++) {
    if (!hits[i].face || hits[i].faceIndex == null) continue;
    return hits[i];
  }
  return null;
}

function meshOwning(object, mesh) {
  let o = object;
  while (o) {
    if (o === mesh) return true;
    o = o.parent;
  }
  return false;
}

/* --------------------------------------------------------------- camera -- */

function viewPose(mesh, camera, dir) {
  const THREE = window.THREE;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const eye = center.clone().addScaledVector(d, Math.max(radius * 3, radius + 10));
  const q = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(eye, center, up)
  );
  return {
    position: { x: eye.x, y: eye.y, z: eye.z },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
    fov: camera.fov, aspect: camera.aspect, zoom: camera.zoom,
  };
}

/* The piece's silhouette in NDC, so the sweep stays on the piece whatever the
   fov, the aspect or the piece's proportions are. Projection only - it picks
   nothing and decides nothing. */
function silhouetteNdc(mesh, camera) {
  const THREE = window.THREE;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const v = new THREE.Vector3();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    v.project(camera);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return { minX, minY, maxX, maxY };
}

function sweepSamples(box) {
  const spanX = (box.maxX - box.minX) * (1 - 2 * SWEEP_INSET);
  const spanY = (box.maxY - box.minY) * (1 - 2 * SWEEP_INSET);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const out = [];
  for (let iy = 0; iy < SWEEP_STEPS; iy++) {
    for (let ix = 0; ix < SWEEP_STEPS; ix++) {
      const fx = SWEEP_STEPS === 1 ? 0 : (ix / (SWEEP_STEPS - 1)) - 0.5;
      const fy = SWEEP_STEPS === 1 ? 0 : (iy / (SWEEP_STEPS - 1)) - 0.5;
      out.push({ x: cx + fx * spanX, y: cy + fy * spanY, r: Math.abs(fx) + Math.abs(fy) });
    }
  }
  out.sort((a, b) => a.r - b.r);
  return out;
}

/* Which of the mesh's own faces a world direction is looking at. Done through
   the mesh's inverse world matrix rather than assumed from the world axis, so
   a placed piece that ever carries a rotation still resolves correctly. */
function expectedFace(mesh, dir) {
  const THREE = window.THREE;
  mesh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const n = new THREE.Vector3(dir[0], dir[1], dir[2]).transformDirection(inv).normalize();
  const abs = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
  let axis = 0;
  if (abs[1] > abs[axis]) axis = 1;
  if (abs[2] > abs[axis]) axis = 2;
  return { axis, sign: ([n.x, n.y, n.z][axis] >= 0) ? 1 : -1 };
}

/* ----------------------------------------------------------------- paint -- */

/* One hull face, from one axis view. Returns the pick or a reason it could
   not be made - never a guess, and never a pick on a face other than the one
   this view is looking at. */
function pickHullFace(fixture, view, isAim) {
  const host = window.__CTH_HOST__;
  const st = window.state;
  const canvas = st.renderer.domElement;
  host.setCameraState(viewPose(fixture.mesh, st.camera, view.dir));
  const want = expectedFace(fixture.mesh, view.dir);
  const samples = sweepSamples(silhouetteNdc(fixture.mesh, st.camera));
  const tried = { offPiece: 0, pocket: 0, wrongFace: 0, notFlat: 0, recessed: 0 };

  for (const s of samples) {
    const point = ndcPoint(canvas, s.x, s.y);
    const hostHit = host.raycastAtScreenPoint(point);
    if (!isAim(hostHit)) {
      if (hostHit && hostHit.hit && hostHit.region === 'pocket') tried.pocket++;
      else tried.offPiece++;
      continue;
    }
    const raw = rawHitAt(point);
    if (!raw || !meshOwning(raw.object, fixture.mesh)) { tried.offPiece++; continue; }
    const face = window.nsoFaceFromHit(fixture.model, fixture.mesh, raw);
    if (!face) { tried.notFlat++; continue; }
    if (!face.flat) { tried.notFlat++; continue; }
    if (face.dispAxis !== want.axis || face.dispSign !== want.sign) { tried.wrongFace++; continue; }
    if (!face.outer) { tried.recessed++; continue; }
    return { ok: true, view: view.key, ndc: { x: point.xNDC, y: point.yNDC }, raw, face, hostHit };
  }
  return { ok: false, view: view.key, tried };
}

function faceAlreadyExcluded(model, face) {
  return !!window.nsoMaskIsExcludedPick(
    model, face.rawAxisIdx, face.rawKeepMin, face.rawPlane, !face.outer
  );
}

/* ----------------------------------------------------------------- press -- */

function statusText() {
  const el = document.getElementById('status');
  return el ? el.textContent : '';
}

function adjustStatusText() {
  const el = document.getElementById('adjust-status');
  return el ? el.textContent : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Wait for the press to produce its own line. A bake through the pockets is
   async and announces itself with 'Wrapping ...' first, so both the
   unchanged line and the pending line keep the wait going. */
async function settle(before, timeoutMs) {
  const started = Date.now();
  let last = gradeNestSoftenStatus(statusText());
  while (Date.now() - started < timeoutMs) {
    const text = statusText();
    const graded = gradeNestSoftenStatus(text);
    const busy = !!(window.state && window.state.nsoWrapBusy);
    if (text !== before && graded.result !== 'pending' && !busy) return graded;
    last = graded;
    await sleep(SETTLE_POLL_MS);
  }
  return { result: 'miss', reason: 'timeout', status: last.status };
}

/* ------------------------------------------------------------------ run -- */

function report(fields) {
  const out = Object.assign({ generatedAt: new Date().toISOString() }, fields);
  if (typeof window !== 'undefined') window.__CTH_DRIVE_REPORT__ = out;
  return out;
}

function note(overlay, text, warn) {
  if (overlay && typeof overlay.setNote === 'function') overlay.setNote(text, !!warn);
}

/**
 * Drive Paint (six hull faces) + Full wrap + one Soften, and grade the bake.
 *
 * @param {object}   [opts]
 * @param {function} [opts.gradeHit]  Nest's vendored cth/grade.js `gradeHit`,
 *                                    used for the aim test so the alias and
 *                                    region rule has exactly one implementation.
 * @param {object}   [opts.overlay]   an existing CTH overlay to write the note
 *                                    into; defaults to `window.__CTH_OVERLAY__`.
 * @param {number}   [opts.timeoutMs]
 * @returns {Promise<object>} the run report; `result` is pass | fail | miss.
 */
export async function runPaintSoftenDrive(opts = {}) {
  const overlay = opts.overlay || (typeof window !== 'undefined' ? window.__CTH_OVERLAY__ : null);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  const missing = missingHooks();
  if (missing.length) {
    note(overlay, 'Drive miss - Nest is missing ' + missing.length + ' hook(s). See console.', true);
    console.warn('[cth-drive] missing hooks:', missing);
    return report({ result: 'miss', reason: 'missing-hooks', missing });
  }

  const host = window.__CTH_HOST__;
  const st = window.state;
  const isAim = makeAimTest(opts.gradeHit);

  const fixture = findFixture();
  if (!fixture) {
    note(overlay, 'Drive miss - no ' + FIXTURE_ALIASES.join(' / ') + ' on the plate.', true);
    return report({ result: 'miss', reason: 'fixture-not-on-plate', aliases: FIXTURE_ALIASES.slice() });
  }

  /* Soften works on the active model, and the active model is whatever is
     selected. Nest's own selection call, so nothing here reaches around it. */
  window.selectPlaced(fixture.placedIndex);
  const active = window.getActiveModel();
  if (!active || active.id !== fixture.model.id) {
    note(overlay, 'Drive miss - could not make the fixture the active piece.', true);
    return report({ result: 'miss', reason: 'fixture-not-active', fixture: fixture.name });
  }
  if (!fixture.model.rawTris) {
    note(overlay, 'Drive miss - fixture has no raw soup; Paint and Soften both refuse it.', true);
    return report({ result: 'miss', reason: 'no-raw-soup', fixture: fixture.name });
  }

  /* Step 1 - Paint on, through Nest's own button. */
  const paintBtn = document.getElementById('btn-mask-paint');
  if (!st.maskPaint) paintBtn.click();
  if (!st.maskPaint) {
    note(overlay, 'Drive miss - Paint faces did not turn on: ' + statusText(), true);
    return report({ result: 'miss', reason: 'paint-did-not-arm', status: statusText(), fixture: fixture.name });
  }

  /* Step 2 - the six outer hull faces, one axis view each, all in one
     synchronous pass so the orbit controls never see the moved camera. */
  const cameraBefore = host.getCameraState();
  const faces = [];
  let pickFailure = null;
  try {
    for (const view of AXIS_VIEWS) {
      const pick = pickHullFace(fixture, view, isAim);
      if (!pick.ok) { pickFailure = { stage: 'pick', view: view.key, tried: pick.tried }; break; }

      let excluded = faceAlreadyExcluded(fixture.model, pick.face);
      let toggled = false;
      if (!excluded) {
        toggled = window.nsoMaskToggleAt(fixture.model, fixture.mesh, pick.raw);
        excluded = faceAlreadyExcluded(fixture.model, pick.face);
      }
      faces.push({
        view: pick.view,
        ndc: pick.ndc,
        objectId: pick.hostHit.objectId,
        region: pick.hostHit.region,
        dispAxis: pick.face.dispAxis,
        dispSign: pick.face.dispSign,
        rawAxisIdx: pick.face.rawAxisIdx,
        rawKeepMin: !!pick.face.rawKeepMin,
        toggled,
        excluded,
      });
      if (!excluded) {
        pickFailure = { stage: 'exclude', view: view.key, status: statusText() };
        break;
      }
    }
  } finally {
    host.setCameraState(cameraBefore);
  }

  const yellowTris = window.nsoMaskRepaint();
  const maskCount = window.nsoMaskCount(fixture.model);
  const sides = window.nsoMaskFaces(fixture.model);

  if (pickFailure) {
    if (st.maskPaint) paintBtn.click();
    const msg = pickFailure.stage === 'pick'
      ? 'Drive stop - no outer hull face on ' + pickFailure.view +
        '. This fixture does not present a six-face hull.'
      : 'Drive stop - Nest refused to exclude the ' + pickFailure.view + ' face: ' +
        pickFailure.status;
    note(overlay, msg, true);
    console.warn('[cth-drive]', msg, pickFailure);
    return report({
      result: 'miss',
      reason: pickFailure.stage === 'pick' ? 'hull-face-not-found' : 'face-not-excluded',
      view: pickFailure.view, tried: pickFailure.tried || null,
      status: pickFailure.status || statusText(),
      fixture: fixture.name, paint: { faces, count: maskCount, sides },
    });
  }

  /* `nsoMaskFaces` is null the moment a painted face is a recessed wall, and
     otherwise reads back the axis and side of every face the clicks named.
     Six of six is the whole acceptance for step 2 - nothing is inferred from
     the count alone. */
  const allSix = !!sides && sides.every((pair) => pair[0] && pair[1]);
  if (!allSix || maskCount !== 6) {
    if (st.maskPaint) paintBtn.click();
    const msg = sides === null
      ? 'Drive stop - a face already painted on this piece is a pocket wall, not a hull ' +
        'face. Clear paint and run again.'
      : 'Drive stop - the paint covers ' + maskCount + ' face(s), not the six hull faces.';
    note(overlay, msg, true);
    return report({
      result: 'miss', reason: sides === null ? 'paint-includes-pocket-wall' : 'hull-not-six',
      fixture: fixture.name, paint: { faces, count: maskCount, sides, yellowTris },
    });
  }

  /* Step 3 - Paint off, same button. */
  if (st.maskPaint) paintBtn.click();
  if (st.maskPaint) {
    note(overlay, 'Drive miss - Paint faces would not turn off.', true);
    return report({ result: 'miss', reason: 'paint-stuck-on', fixture: fixture.name });
  }

  /* Step 4 - Full wrap on, read back through Nest's own accessor. */
  const wrapChk = document.getElementById('chk-full-wrap');
  if (!wrapChk.checked) {
    wrapChk.checked = true;
    wrapChk.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const fullWrap = window.getFullWrap();
  if (!fullWrap) {
    note(overlay, 'Drive miss - Full wrap would not stay on.', true);
    return report({ result: 'miss', reason: 'full-wrap-off', fixture: fixture.name });
  }

  /* The gate the ticket asks for: Nest's own answer to "this piece needs no
     face picked". False here means Full wrap is on and six faces are painted,
     so the only thing left that it can be is the pocket. */
  const wrapAllReady = window.nsoWrapAllReady(fixture.model);
  if (!wrapAllReady) {
    const msg = 'Drive stop - six hull faces are painted and Full wrap is on, but Nest finds no ' +
      'pocket on this piece. Fixture is not a six-face hull plus pocket.';
    note(overlay, msg, true);
    return report({
      result: 'miss', reason: 'no-pocket', fixture: fixture.name, fullWrap,
      paint: { faces, count: maskCount, sides, yellowTris },
    });
  }

  /* Step 5 - one press. Not armed, and nothing clicked on the canvas. */
  if (st.softenArmed) {
    note(overlay, 'Drive miss - Soften was already armed; a press would cancel it.', true);
    return report({ result: 'miss', reason: 'soften-pre-armed', fixture: fixture.name });
  }
  const statusBefore = statusText();
  document.getElementById('btn-soften').click();
  const graded = await settle(statusBefore, timeoutMs);

  const out = report({
    result: graded.result === 'pending' ? 'miss' : graded.result,
    reason: graded.reason,
    fixture: fixture.name,
    fullWrap,
    wrapAllReady,
    armed: !!st.softenArmed,
    paint: { faces, count: maskCount, sides, yellowTris },
    status: graded.status,
    adjustStatus: adjustStatusText(),
    elapsedMs: Date.now() - startedAt,
  });

  note(
    overlay,
    'Drive ' + out.result.toUpperCase() + ' (' + out.reason + ') - ' + out.status,
    out.result !== 'pass'
  );
  console.log('[cth-drive]', out.result, out.reason, out);
  return out;
}

/* ---------------------------------------------------------------- mount -- */

export function shouldDrive(search) {
  const query = search != null ? search : (typeof location !== 'undefined' ? location.search : '');
  const v = new URLSearchParams(String(query || '')).get('cth');
  return v != null && String(v).toLowerCase() === 'drive';
}

/**
 * Install `window.__CTH_DRIVE__` and run once. Safe to call more than once -
 * the run is only started by the first call.
 */
export function mountNestDrive(opts = {}) {
  const api = {
    run: (o) => runPaintSoftenDrive(Object.assign({}, opts, o)),
    get lastReport() { return window.__CTH_DRIVE_REPORT__ || null; },
  };
  if (window.__CTH_DRIVE__) return window.__CTH_DRIVE__;
  window.__CTH_DRIVE__ = api;
  if (opts.autoRun !== false) api.run();
  return api;
}

export default runPaintSoftenDrive;
