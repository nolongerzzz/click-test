/**
 * click-test-harness / grade
 *
 * The single grading rule, shared by both consumers:
 *   - src/harness.js   grades a live click in the page
 *   - replay/replay.js grades a replayed click in Node
 *
 * These were previously two byte-for-byte copies of the same logic. That is a
 * bad place to duplicate: the two copies can drift, and a fixture only ever
 * exercises one of them, so a rule that got too permissive in the other would
 * never show up. Keeping one implementation means fixtures/negative-controls.json
 * and replay/grade-check.js protect both.
 *
 * Pure and DOM-free on purpose so Node and the browser can both import it.
 *
 * HOST CONTRACT (locked — a host adapter must return this shape)
 * -------------------------------------------------------------
 *   hit = { hit, objectId, region, point, normal, distance }
 *
 *   hit       boolean — false means the ray reached nothing
 *   objectId  string  — the picked object's stable id
 *   region    'hull' | 'pocket' | null — which part of the piece was hit
 *   point     {x,y,z} world-space intersection
 *   normal    {x,y,z} LOCAL-space surface normal, or null
 *   distance  number  — along the ray
 *
 * ACCEPT SHAPE
 * ------------
 *   accept = { objectId?, region?, normals?, normalTolerance? }
 *
 *   objectId  string OR string[] — any one matching is enough
 *   region    'hull' | 'pocket'  — when set, hit.region must equal it exactly
 *   normals   [[x,y,z], ...]     — local-space directions, any one may match
 */

/**
 * Minimum dot product between the hit's surface normal and an accepted normal
 * for the two to count as the same direction. ~18 degrees of slop.
 */
export const DEFAULT_NORMAL_TOLERANCE = 0.95;

/** The regions a host may report. `null` means "not part of a regioned piece". */
export const REGIONS = ['hull', 'pocket'];

/**
 * An accepted id matches a hit id exactly, or as a PREFIX of it, so a spec can
 * name a part family without knowing the dimensions baked into the instance
 * name: `box_hull` matches `box_hull_80x40x20`.
 *
 * This is a plain prefix, as specified — `box_hull` would also match a
 * hypothetical `box_hullX`. In practice the hull/pocket distinction is carried
 * by `region`, which is checked separately and exactly, so a loose id prefix
 * cannot on its own turn a pocket pick into a hull pass.
 */
export function objectIdMatches(accepted, hitObjectId) {
  if (typeof hitObjectId !== 'string') return false;
  const ids = Array.isArray(accepted) ? accepted : [accepted];
  return ids.some((id) => typeof id === 'string' && id.length > 0 && hitObjectId.startsWith(id));
}

/**
 * @param accept  see ACCEPT SHAPE above; every field is optional, and an
 *                accept with no constraints passes any hit
 * @param hit     see HOST CONTRACT above
 * @returns 'pass' | 'fail' | 'miss'
 */
export function gradeHit(accept, hit) {
  if (!hit || !hit.hit) return 'miss';
  if (!accept) return 'pass';

  // Each constraint is checked independently. There is deliberately no early
  // "nothing to check" return here: an accept carrying only `region` (or only
  // `normals`) has to be honoured, and the previous shape returned 'pass'
  // before looking at anything whenever objectId was absent.
  if (accept.objectId != null) {
    if (!objectIdMatches(accept.objectId, hit.objectId)) return 'fail';
  }

  if (accept.region != null) {
    // Exact, and a host that reports no region cannot satisfy a spec that
    // demands one — otherwise an adapter that simply forgot to emit `region`
    // would silently pass every regioned aim.
    if (hit.region !== accept.region) return 'fail';
  }

  if (accept.normals && accept.normals.length) {
    const hn = hit.normal;
    if (!hn) return 'fail';
    const tolerance = typeof accept.normalTolerance === 'number'
      ? accept.normalTolerance
      : DEFAULT_NORMAL_TOLERANCE;
    // Strictly greater than, matching the original behaviour: a dot exactly
    // equal to the tolerance does not pass.
    const ok = accept.normals.some(([nx, ny, nz]) => (hn.x * nx + hn.y * ny + hn.z * nz) > tolerance);
    if (!ok) return 'fail';
  }

  return 'pass';
}
