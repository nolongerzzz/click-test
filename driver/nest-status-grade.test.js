/**
 * Node test for driver/nest-status-grade.js.
 *
 * Every string below is a real Nest `#status` line, assembled from the
 * setStatus calls in nest-optimizer's app-finish.js at the commit this driver
 * was written against. The point of the file is the two rows the ticket turns
 * on: an armed press and a cancelled press must grade `fail` even though the
 * word "Soften" is in both, and a wrap that baked must grade `pass`.
 *
 *   node driver/nest-status-grade.test.js
 */

import { gradeNestSoftenStatus } from './nest-status-grade.js';

const CASES = [
  // --- the bake. This is the only thing that may grade pass. ---
  ['Round wrap R 0.50 on a pocket piece - 5 of 11 faces baked (hull 0/6, pocket 5/5), 6 painted out and left square (412 tris, one bake from source)', 'pass', 'wrap-bake'],
  ['Bevel wrap R 1.00 inside - 1 pocket wrapped, 6 face(s) painted out and left square, hull untouched (388 tris, one bake from source)', 'pass', 'wrap-bake'],
  ['Soften ok - round on all 96 loop pts at R 0.50', 'pass', 'soften-ok'],
  ['Soften ok', 'pass', 'soften-ok'],
  ['Corners R 2.50 at 4 corners', 'pass', 'corners-bake'],
  ['corners+edges setback R 2.50 at 4 corners', 'pass', 'setback-bake'],
  ['Soften ok - nothing to add on this face (already round)', 'pass', 'soften-ok-noop'],

  // --- the arm. The whole bug the driver exists to catch. ---
  ['Soften (round): click a face', 'fail', 'armed'],
  ['Soften (bevel): click a face', 'fail', 'armed'],
  ['Soften (corners+edges): click a face', 'fail', 'armed'],
  ['Soften cancelled', 'fail', 'cancelled'],
  ['Click a face', 'fail', 'armed'],
  ['Click a face on a placed piece', 'fail', 'armed'],
  ['Click an outer face - that one is recessed 10.00mm behind the outside', 'fail', 'pick-refused-recessed'],
  ['Click a flat face - that spot is on a curve', 'fail', 'pick-refused-curved'],

  // --- refusals. Never a pass, and each names its own reason. ---
  ['Wrap found no pocket to work on. Piece unchanged', 'fail', 'no-pocket'],
  ['Wrap needs faces it can name - a painted patch here is not a flat face. Piece unchanged', 'fail', 'unnameable-face'],
  ['Wrap stopped - the x- hull face is gone from this piece; the soup has no face on that plane', 'fail', 'wrap-stopped'],
  ['Wrap failed - the cut did not close (open 0→4, non-manifold 0→0). Piece unchanged', 'fail', 'failed'],
  ['Soften failed - wrap empty. Piece unchanged', 'fail', 'failed'],
  ['Still wrapping the last click', 'fail', 'busy'],
  ['That face is painted out - include it first, or pick another face', 'fail', 'face-painted-out'],
  ['That face is inside the piece - only a Full wrap can reach it, and this piece is not one', 'fail', 'face-recessed'],
  ['Select a piece first', 'fail', 'no-piece'],
  ['Soften needs a Square-split or loaded raw piece', 'fail', 'no-raw-soup'],

  // --- still running. The caller keeps waiting rather than grading. ---
  ['Wrapping 1 pocket, 6 face(s) painted out…', 'pending', 'wrapping'],
  ['Wrapping 5 face(s), 6 painted out…', 'pending', 'wrapping'],

  // --- nothing to grade. ---
  ['', 'miss', 'no-status'],
  [null, 'miss', 'no-status'],
  ['Paint off - 6 face(s) excluded', 'miss', 'unrecognised'],
  ['Excluded the X- face (8 tris yellow) - 1 face(s) excluded', 'miss', 'unrecognised'],
];

let failed = 0;
for (const [status, wantResult, wantReason] of CASES) {
  const got = gradeNestSoftenStatus(status);
  const ok = got.result === wantResult && got.reason === wantReason;
  if (!ok) {
    failed++;
    console.error(
      'BROKEN  ' + JSON.stringify(status) +
      '\n        want ' + wantResult + '/' + wantReason +
      '\n        got  ' + got.result + '/' + got.reason
    );
  }
}

if (failed) {
  console.error('\n' + failed + ' of ' + CASES.length + ' status cases graded wrong.');
  process.exit(1);
}
console.log('nest-status-grade: ' + CASES.length + '/' + CASES.length + ' status lines graded as specified.');
