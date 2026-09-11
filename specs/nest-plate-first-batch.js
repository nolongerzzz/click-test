/**
 * Live batch 1 — Nest plate (box_hull + pocket, after Seat/Subtract)
 *
 * Plate under test, as described by the owner: box_hull + pocket, 6 outer
 * faces painted, Soften already baked (hull 0/6 square, pocket 5/5). This is
 * NOT the closed-box FAIL plate.
 *
 * These are AIM-BY-EYE specs: no `target`, so the harness places no marker and
 * the tester aims at the real feature by description. That is deliberate —
 * placing a marker would need local normals and half-extents for this plate,
 * which are not known here. Grading only needs `accept`.
 *
 * Accept blocks follow the LOCKED host contract:
 *   objectId  ["box_hull", "CTH_fixture"] — either part is a legitimate pick,
 *             matched as a PREFIX, so box_hull covers box_hull_80x40x20 and
 *             the spec does not have to know the instance dimensions.
 *   region    'hull' | 'pocket' — checked exactly against hit.region. This is
 *             what separates the aims: all four allow the same two part ids,
 *             and only the region tells the pocket floor apart from the hull
 *             around it.
 *
 * Because the ids overlap, region is doing the real work here. An adapter that
 * stopped emitting `region` would fail every aim rather than silently pass
 * them — see replay/grade-check.js.
 */

const PLATE_IDS = ['box_hull', 'CTH_fixture'];

export const NEST_PLATE_FIRST_BATCH = [
  {
    id: 'hull-face',
    title: 'Hull face — opposite wall',
    instruction: 'The yellow wall opposite the opening, the one with no hole in it. Click the flat of it, away from any edge.',
    accept: { objectId: PLATE_IDS, region: 'hull' },
  },
  {
    id: 'slot-mouth',
    title: 'Slot mouth — pocket floor',
    instruction: 'The red floor inside the opening. Click straight down the mouth so the ray reaches the pocket, not its rim.',
    accept: { objectId: PLATE_IDS, region: 'pocket' },
  },
  {
    id: 'occlusion',
    title: 'Occlusion — near lip in front of the pocket',
    instruction: 'The yellow rim of that same opening, the near lip. The pocket sits directly behind it, so the lip must win.',
    // The whole point of this aim: hull in front beats pocket behind. Since
    // both regions live on the same part ids, a `pocket` result here is caught
    // by region alone — the id check would have passed it.
    accept: { objectId: PLATE_IDS, region: 'hull' },
  },
  {
    id: 'after-tip',
    title: 'After tip — same wall as aim 1',
    instruction: 'Tip the part once, then click the SAME opposite wall as aim 1 from the new angle.',
    // Guards the rotation path: a stale world matrix or an unrestored camera
    // makes this one diverge from hull-face while the other three still pass.
    accept: { objectId: PLATE_IDS, region: 'hull' },
  },
];

export default NEST_PLATE_FIRST_BATCH;
