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
 * protects both.
 *
 * Pure and DOM-free on purpose so Node and the browser can both import it.
 */

/**
 * Minimum dot product between the hit's surface normal and an accepted normal
 * for the two to count as the same direction. ~18 degrees of slop.
 */
export const DEFAULT_NORMAL_TOLERANCE = 0.95;

/**
 * @param accept  { objectId?, normals?: [[x,y,z], ...], normalTolerance?: number }
 *                `normalTolerance` is optional and defaults to
 *                DEFAULT_NORMAL_TOLERANCE. Loosen it (towards 0) for curved or
 *                non-axis-aligned geometry, where the face normal at the click
 *                point legitimately sits further off the nominal direction.
 * @param hit     { hit:boolean, objectId?, normal?: {x,y,z} }
 * @returns 'pass' | 'fail' | 'miss'
 */
export function gradeHit(accept, hit) {
  if (!hit || !hit.hit) return 'miss';
  if (!accept || !accept.objectId) return 'pass';
  if (hit.objectId !== accept.objectId) return 'fail';

  if (accept.normals && accept.normals.length) {
    const hn = hit.normal;
    if (!hn) return 'fail';
    const tolerance = typeof accept.normalTolerance === 'number'
      ? accept.normalTolerance
      : DEFAULT_NORMAL_TOLERANCE;
    // Strictly greater than, matching the original behaviour: a dot exactly
    // equal to the tolerance does not pass.
    const ok = accept.normals.some(([nx, ny, nz]) => (hn.x * nx + hn.y * ny + hn.z * nz) > tolerance);
    return ok ? 'pass' : 'fail';
  }

  return 'pass';
}
