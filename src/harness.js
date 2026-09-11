/**
 * click-test-harness / core
 *
 * Engine-agnostic. Knows nothing about Three.js, Babylon, or canvas —
 * it only talks to a "host adapter" object that implements a small
 * contract (see below). This is what makes the same harness reusable
 * across any raycasting/picking app, not just this one project.
 *
 * HOST CONTRACT
 * --------------
 * host.placeMarker(target)         -> show a visual target for the test, however the host wants
 * host.clearMarker()               -> hide it
 * host.raycastAtScreenPoint(pt)    -> { hit:boolean, objectId, point:{x,y,z}, normal:{x,y,z}, distance } | { hit:false }
 * host.getCameraState()            -> any serializable object; opaque to the harness, used for logging/replay
 * host.setCameraState(state)       -> optional, only required for headless replay mode
 * host.onPointerCapture(el, cb)    -> optional; if omitted, the harness attaches its own listeners to `container`
 *
 * TEST SPEC
 * ---------
 * {
 *   id, title, instruction,
 *   target: { objectId, kind: 'face'|'edge'|'occlusion'|'placement', normal?: [x,y,z], worldPoint?: [x,y,z] },
 *   accept: { objectId, normals?: [[x,y,z], ...], normalTolerance?: number }
 *           // optional, defaults derived from target.
 *           // normalTolerance defaults to 0.95 — see src/grade.js
 * }
 */

import { gradeHit } from './grade.js';
import { createPointerCapture } from './pointer-capture.js';

export function createClickTestHarness({
  container,
  host,
  tests,
  onResult,
  onComplete,
  onDragIgnored,
  // 'listen'  (default) attach ordinary bubble-phase listeners. Fine when the
  //           harness is the only thing reading pointer input on the canvas.
  // 'capture' take the gesture away from the host's own move/orbit tooling —
  //           required when a host drag handler would otherwise swallow the
  //           pick. Starts DISARMED so the tester can still orbit; call
  //           armOnce() to claim the next gesture. See src/pointer-capture.js.
  pointerMode = 'listen',
}) {
  if (!container) throw new Error('createClickTestHarness: container is required');
  if (!host) throw new Error('createClickTestHarness: host adapter is required');
  if (!Array.isArray(tests) || tests.length === 0) throw new Error('createClickTestHarness: tests[] is required');

  let current = 0;
  let testStart = performance.now();
  let dragStart = null;
  let dragged = false;
  let completed = false;
  let capture = null;
  const results = [];

  function currentTest() { return tests[current]; }

  function start() {
    setupTest(0);
    attachListeners();
  }

  function setupTest(i) {
    host.clearMarker();
    const t = tests[i];
    if (t.target && t.target.kind !== 'placement') {
      host.placeMarker(t.target);
    } else if (t.target && t.target.kind === 'placement' && t.target.worldPoint) {
      host.placeMarker(t.target);
    }
    testStart = performance.now();
  }

  function attachListeners() {
    const down = (e) => {
      dragged = false;
      dragStart = { x: clientX(e), y: clientY(e) };
    };
    const move = (e) => {
      if (!dragStart) return;
      if (Math.abs(clientX(e) - dragStart.x) + Math.abs(clientY(e) - dragStart.y) > 6) dragged = true;
    };
    const up = (e) => {
      if (!dragStart) return;
      if (!dragged) handleClick(clientX(e), clientY(e));
      dragStart = null;
    };
    if (pointerMode === 'capture') {
      capture = createPointerCapture({
        container,
        onClick: (x, y) => handleClick(x, y),
        onDrag: () => { if (onDragIgnored) onDragIgnored(); },
      });
      return;
    }
    if (host.onPointerCapture) {
      host.onPointerCapture(container, { down, move, up });
    } else {
      container.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
  }

  function clientX(e) { return e.clientX; }
  function clientY(e) { return e.clientY; }

  function handleClick(clientXpx, clientYpx) {
    if (current >= tests.length) return;
    const rect = container.getBoundingClientRect();
    const xPix = clientXpx - rect.left, yPix = clientYpx - rect.top;
    const point = {
      xPix: Math.round(xPix), yPix: Math.round(yPix),
      xNDC: +(((xPix / rect.width) * 2 - 1).toFixed(4)),
      yNDC: +((-(yPix / rect.height) * 2 + 1).toFixed(4)),
      canvasWidth: Math.round(rect.width), canvasHeight: Math.round(rect.height),
    };

    const hit = host.raycastAtScreenPoint(point);
    const t = currentTest();
    const result = grade(t, hit);

    const entry = {
      testId: t.id,
      title: t.title,
      reactionMs: Math.round(performance.now() - testStart),
      camera: host.getCameraState ? host.getCameraState() : null,
      clickScreen: point,
      hit: hit && hit.hit ? {
        objectId: hit.objectId,
        point: hit.point,
        normal: hit.normal,
        distance: hit.distance,
      } : null,
      expected: acceptFor(t),
      result,
    };
    results.push(entry);
    // Advance BEFORE notifying: consumers read harness.currentTest /
    // currentIndex inside onResult to render the next instruction, so the
    // index has to already point at the next test by the time they do.
    advance();
    if (onResult) onResult(entry);
    finishIfDone();
  }

  // The rule itself lives in src/grade.js so replay/replay.js grades a
  // replayed click exactly the way this grades a live one.
  function grade(t, hit) {
    return gradeHit(acceptFor(t), hit);
  }

  function acceptFor(t) {
    return t.accept || { objectId: t.target ? t.target.objectId : null };
  }

  function skip() {
    if (current >= tests.length) return;
    const t = currentTest();
    const entry = { testId: t.id, title: t.title, result: 'skipped' };
    results.push(entry);
    advance();
    if (onResult) onResult(entry);
    finishIfDone();
  }

  function advance() {
    current++;
    if (current < tests.length) setupTest(current);
    else host.clearMarker();
  }

  // Kept separate from advance() so onComplete always fires AFTER the
  // onResult for the final test rather than before it.
  function finishIfDone() {
    if (current >= tests.length && !completed) {
      completed = true;
      if (onComplete) onComplete(summarize());
    }
  }

  function restart() {
    results.length = 0;
    current = 0;
    completed = false;
    dragStart = null;
    dragged = false;
    setupTest(0);
  }

  function summarize() {
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        pass: results.filter(r => r.result === 'pass').length,
        fail: results.filter(r => r.result === 'fail').length,
        miss: results.filter(r => r.result === 'miss').length,
        skipped: results.filter(r => r.result === 'skipped').length,
      },
      results,
    };
  }

  return {
    start,
    skip,
    restart,
    // Only meaningful in pointerMode:'capture'. No-ops otherwise, so a caller
    // can wire an "Arm pick" control without branching on the mode.
    armOnce: () => { if (capture) capture.armOnce(); },
    arm: () => { if (capture) capture.arm(); },
    disarm: () => { if (capture) capture.disarm(); },
    isArmed: () => (capture ? capture.isArmed() : false),
    dispose: () => { if (capture) capture.dispose(); },
    getResults: () => results.slice(),
    getSummary: summarize,
    get currentIndex() { return current; },
    get totalTests() { return tests.length; },
    get currentTest() { return currentTest(); },
  };
}
