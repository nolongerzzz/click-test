/**
 * click-test-harness / pointer-capture
 *
 * Takes a click away from the host app's own input tooling.
 *
 * THE PROBLEM
 * -----------
 * The harness's default listener is a bubble-phase `pointerdown` on the canvas
 * with no preventDefault and no stopPropagation. A host that also listens on
 * that canvas — a move gizmo, a transform control, an orbit controller — gets
 * the same event and acts on it. The model slides, the pointer travels more
 * than the drag threshold, and the harness classifies the whole gesture as a
 * drag, so it never grades anything. The observable symptom is a host status
 * like "Moved model #1" with zero face hits recorded.
 *
 * THE FIX
 * -------
 * Listen in the CAPTURE phase on an ancestor (window by default), not on the
 * canvas. Capture listeners on an ancestor run strictly before ANY listener on
 * the canvas, whatever order those were registered in — which a capture
 * listener on the canvas itself would not, since same-element capture and
 * bubble listeners both fire in the target phase in registration order.
 * stopImmediatePropagation() then means the host's handler never runs at all.
 *
 * ARMING
 * ------
 * Suppressing host input permanently would also kill orbiting, and a tester
 * needs to orbit to line a shot up (and to tip the part between aims). So this
 * is armed per pick: `armOnce()` consumes exactly the next gesture on the
 * container and then stands down, leaving normal host interaction alone.
 */

const DOWN_EVENTS = ['pointerdown', 'mousedown', 'touchstart'];
const MOVE_EVENTS = ['pointermove', 'mousemove', 'touchmove'];
const UP_EVENTS = ['pointerup', 'mouseup', 'touchend', 'pointercancel', 'touchcancel'];
// Browsers synthesise these after a mouse gesture; the host must not get them either.
const TAIL_EVENTS = ['click', 'dblclick', 'contextmenu', 'dragstart'];

const TAIL_SUPPRESS_MS = 700;

function pointOf(event) {
  if (event.touches && event.touches.length) return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  if (event.changedTouches && event.changedTouches.length) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  return { x: event.clientX, y: event.clientY };
}

/**
 * @param container        element whose events should be intercepted (the canvas)
 * @param onClick(x, y)    called with client coords for a gesture that stayed put
 * @param onDrag()         called instead when the gesture moved too far to be a click
 * @param dragThresholdPx  Manhattan distance that separates a click from a drag
 * @param root             ancestor to listen on; must contain `container`
 */
export function createPointerCapture({
  container,
  onClick,
  onDrag,
  dragThresholdPx = 6,
  root = typeof window !== 'undefined' ? window : null,
}) {
  if (!container) throw new Error('createPointerCapture: container is required');
  if (!root) throw new Error('createPointerCapture: no root to listen on');

  let armed = false;
  let sticky = false;
  let gesture = null;
  let tailUntil = 0;
  const bound = [];

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function inContainer(event) {
    const t = event.target;
    return t === container || (t && container.contains && container.contains(t));
  }

  // Consume the event outright: the host's listeners never see it.
  function consume(event) {
    event.stopImmediatePropagation();
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
  }

  function onDown(event) {
    if (gesture) {
      // A mouse gesture fires pointerdown AND mousedown. The first one opened
      // the gesture; the duplicate still has to be swallowed.
      if (inContainer(event)) consume(event);
      return;
    }
    if (!armed || !inContainer(event)) return;
    consume(event);
    const p = pointOf(event);
    gesture = { x: p.x, y: p.y, dragged: false };
  }

  function onMove(event) {
    if (!gesture) return;
    // Consume regardless of target: once we own the gesture, a pointer that
    // wanders off the canvas must not hand the host a half-finished drag.
    consume(event);
    const p = pointOf(event);
    if (Math.abs(p.x - gesture.x) + Math.abs(p.y - gesture.y) > dragThresholdPx) gesture.dragged = true;
  }

  function onUp(event) {
    if (!gesture) return;
    consume(event);
    const p = pointOf(event);
    const moved = Math.abs(p.x - gesture.x) + Math.abs(p.y - gesture.y);
    const wasDrag = gesture.dragged || moved > dragThresholdPx;
    gesture = null;
    tailUntil = now() + TAIL_SUPPRESS_MS;
    if (!sticky) armed = false;

    if (wasDrag) {
      if (onDrag) onDrag();
    } else if (onClick) {
      onClick(p.x, p.y);
    }
  }

  function onTail(event) {
    if (now() < tailUntil && inContainer(event)) consume(event);
  }

  function bind(names, handler) {
    for (const name of names) {
      root.addEventListener(name, handler, { capture: true, passive: false });
      bound.push([name, handler]);
    }
  }

  bind(DOWN_EVENTS, onDown);
  bind(MOVE_EVENTS, onMove);
  bind(UP_EVENTS, onUp);
  bind(TAIL_EVENTS, onTail);

  return {
    /** Consume exactly the next gesture on the container, then stand down. */
    armOnce() { armed = true; sticky = false; },
    /** Stay armed until disarm() — every gesture is taken from the host. */
    arm() { armed = true; sticky = true; },
    disarm() { armed = false; sticky = false; gesture = null; },
    isArmed() { return armed; },
    dispose() {
      for (const [name, handler] of bound) root.removeEventListener(name, handler, { capture: true });
      bound.length = 0;
      armed = false;
      gesture = null;
    },
  };
}
