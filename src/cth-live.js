/**
 * click-test-harness / cth-live
 *
 * One entry point for running a live batch inside a real host app, so the host
 * needs exactly one import and one call and no other change.
 *
 * It is inert unless the activation flag is in the URL (`?cth=1` by default),
 * so shipping the call costs the normal app nothing.
 *
 *   import { mountLiveHarness } from '.../src/cth-live.js';
 *   mountLiveHarness({ THREE, scene, camera, renderer, raycastables, tests });
 *
 * `raycastables` is the array of pickable Object3Ds, each with `.name` set to
 * the id used in a spec's accept.objectId.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It reads the host's scene and camera and nothing else. It does not touch
 * geometry, modify host state, or alter any host behaviour — except that while
 * a pick is ARMED it takes one pointer gesture away from the host's own input
 * handlers, which is the entire point (see src/pointer-capture.js). Between
 * picks the host behaves exactly as it always did.
 *
 * One side effect worth knowing: createThreeHostAdapter adds a small
 * `visible:false` marker mesh to the scene for positioning test markers. It is
 * never added to `raycastables`, so it cannot be picked, and specs without a
 * `target` (the usual shape for aim-by-eye live batches) never show it.
 */

import { createThreeHostAdapter } from './three-adapter.js';
import { createClickTestHarness } from './harness.js';
import { createCthOverlay, shouldMount } from './overlay.js';

export function mountLiveHarness({
  THREE,
  scene,
  camera,
  renderer,
  container,
  raycastables,
  tests,
  flag = 'cth',
  force = false,
  title,
  onResult,
  onComplete,
}) {
  if (!force && !shouldMount({ flag })) return null;

  const canvas = container || (renderer && renderer.domElement);
  if (!canvas) throw new Error('mountLiveHarness: pass `container` or a `renderer` with a domElement');
  if (!Array.isArray(tests) || tests.length === 0) throw new Error('mountLiveHarness: tests[] is required');

  const host = createThreeHostAdapter({ THREE, scene, camera, raycastables });

  const overlay = createCthOverlay({
    tests,
    title,
    onArm: () => {
      harness.armOnce();
      overlay.setArmed(true);
      overlay.setNote('Armed. The next click on the model is captured — the app will not move it.');
    },
  });

  const harness = createClickTestHarness({
    container: canvas,
    host,
    tests,
    pointerMode: 'capture',
    onResult: (entry) => {
      overlay.recordResult(entry);
      overlay.setArmed(false);
      overlay.setCurrent(harness.currentIndex);
      overlay.setNote(
        entry.result === 'pass'
          ? 'Recorded. Arm again for the next aim.'
          : `Recorded ${entry.result}. Arm again for the next aim.`,
        entry.result !== 'pass',
      );
      if (onResult) onResult(entry);
    },
    onDragIgnored: () => {
      overlay.setArmed(false);
      overlay.setNote('That gesture moved — treated as a drag, not a pick. Re-arm and click without sliding.', true);
    },
    onComplete: (summary) => {
      overlay.setNote('All aims recorded. window.__CTH_HARNESS__.getSummary() has the fixture.');
      if (onComplete) onComplete(summary);
    },
  });

  harness.start();
  overlay.setCurrent(0);
  overlay.setNote('Ready. Orbit to line up aim 1, then Arm pick.');

  if (typeof window !== 'undefined') {
    window.__CTH_HARNESS__ = harness;
    window.__CTH_OVERLAY__ = overlay;
  }

  return { harness, host, overlay };
}
