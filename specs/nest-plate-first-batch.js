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
 * !! objectId VALUES ARE UNVERIFIED !!
 * `box_hull` and `pocket` are the two names given in the batch report. They
 * must match the `.name` of the meshes actually passed in `raycastables`. If
 * the host names them differently, every aim will grade `fail` with
 * "got <realName>" in the overlay — which tells you the right string to put
 * here. Fix these ids before reading anything into a red batch.
 */

export const NEST_PLATE_FIRST_BATCH = [
  {
    id: 'hull-face',
    title: 'Hull face — opposite wall',
    instruction: 'The yellow wall opposite the opening, the one with no hole in it. Click the flat of it, away from any edge.',
    accept: { objectId: 'box_hull' },
  },
  {
    id: 'slot-mouth',
    title: 'Slot mouth — pocket floor',
    instruction: 'The red floor inside the opening. Click straight down the mouth so the ray reaches the pocket, not its rim.',
    accept: { objectId: 'pocket' },
  },
  {
    id: 'occlusion',
    title: 'Occlusion — near lip in front of the pocket',
    instruction: 'The yellow rim of that same opening, the near lip. The pocket sits directly behind it, so the lip must win.',
    // The whole point of this aim: hull in front beats pocket behind. A
    // `pocket` result here means the near surface lost, which is the classic
    // pick-through-the-front-face bug.
    accept: { objectId: 'box_hull' },
  },
  {
    id: 'after-tip',
    title: 'After tip — same wall as aim 1',
    instruction: 'Tip the part once, then click the SAME opposite wall as aim 1 from the new angle.',
    // Guards the rotation path: a stale world matrix or an unrestored camera
    // makes this one diverge from hull-face while the other three still pass.
    accept: { objectId: 'box_hull' },
  },
];

export default NEST_PLATE_FIRST_BATCH;
