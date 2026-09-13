/**
 * click-test-harness / nest soften status grade
 *
 * The one rule that turns Nest's `#status` line into a pass/fail for a
 * driven Soften. Pure — no DOM, no THREE, no window — so the browser driver
 * and a Node test import the same implementation and cannot drift.
 *
 * Every pattern below is a literal Nest string. Where a pattern is quoted in
 * a comment it is quoted from nest-optimizer at the commit this was written
 * against (app-finish.js / app-join.js setStatus calls), so a Nest wording
 * change shows up as a new `unrecognised` grade rather than a silent pass.
 *
 * Grades:
 *   'pass'    - the press baked. A face count or a wrap radius is in the line.
 *   'fail'    - the press armed, cancelled, or was refused.
 *   'pending' - the bake is still running; the caller keeps waiting.
 *   'miss'    - nothing to grade, or wording this rule does not know.
 */

/* Still working. `setStatus('Wrapping ' + n + ' pocket(s), ...')` and
   `setStatus('Wrapping ' + n + ' face(s), ...')` are written before the
   async cut, and the real answer replaces them when it lands. */
const PENDING = [
  [/^wrapping\b/i, 'wrapping'],
];

/* The whole point of the ticket: the press must not arm. `'Soften (' + label
   + '): click a face'`, and the pick refusals the armed click produces. */
const ARMED = [
  [/^soften cancelled\b/i, 'cancelled'],
  [/\bclick a face\b/i, 'armed'],
  [/^click an outer face\b/i, 'pick-refused-recessed'],
  [/^click a flat face\b/i, 'pick-refused-curved'],
];

/* Refusals. Ordered most specific first so the reason is the real one. */
const REFUSED = [
  [/^still wrapping\b/i, 'busy'],
  [/found no pocket\b/i, 'no-pocket'],
  [/^wrap needs faces it can name\b/i, 'unnameable-face'],
  [/^wrap stopped\b/i, 'wrap-stopped'],
  [/^that face is painted out\b/i, 'face-painted-out'],
  [/^that face is inside the piece\b/i, 'face-recessed'],
  [/^select a piece first\b/i, 'no-piece'],
  [/needs a square-split\b/i, 'no-raw-soup'],
  [/\bfailed\b/i, 'failed'],
  [/piece unchanged\b/i, 'unchanged'],
];

/* A bake, and only a bake. Each carries a number Nest only prints after it
   has committed geometry: a wrap radius, a loop-point count, a face count. */
const BAKED = [
  [/\bwrap r \d/i, 'wrap-bake'],
  [/^corners\+edges setback r \d/i, 'setback-bake'],
  [/^corners r \d/i, 'corners-bake'],
  [/^soften ok\b/i, 'soften-ok'],
];

function firstMatch(table, text) {
  for (const [re, reason] of table) if (re.test(text)) return reason;
  return null;
}

/**
 * @param {string|null|undefined} status  the text of Nest's `#status` element
 * @returns {{result:'pass'|'fail'|'pending'|'miss', reason:string, status:string}}
 */
export function gradeNestSoftenStatus(status) {
  const text = (status == null ? '' : String(status)).trim();
  if (!text) return { result: 'miss', reason: 'no-status', status: text };

  const pending = firstMatch(PENDING, text);
  if (pending) return { result: 'pending', reason: pending, status: text };

  const armed = firstMatch(ARMED, text);
  if (armed) return { result: 'fail', reason: armed, status: text };

  const refused = firstMatch(REFUSED, text);
  if (refused) return { result: 'fail', reason: refused, status: text };

  const baked = firstMatch(BAKED, text);
  if (baked) {
    /* 'Soften ok - nothing to add on this face (...)' is Nest reporting a
       clean run that changed nothing. It is not an arm and not a refusal, so
       it grades pass, but the reason says it added no material. */
    if (/nothing to add\b/i.test(text)) {
      return { result: 'pass', reason: 'soften-ok-noop', status: text };
    }
    return { result: 'pass', reason: baked, status: text };
  }

  return { result: 'miss', reason: 'unrecognised', status: text };
}

export default gradeNestSoftenStatus;
