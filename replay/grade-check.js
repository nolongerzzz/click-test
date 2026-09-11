#!/usr/bin/env node
/**
 * click-test-harness / replay / grade-check.js
 *
 * Locks the host contract's grading rules. These are pure logic, so they are
 * checked directly against a table rather than through a browser: a fixture
 * replay can only grade whatever the demo scene happens to raycast, and cannot
 * express an arbitrary objectId/region pair — which is exactly what the
 * objectId-array, prefix and region rules need.
 *
 * Contract under test:
 *   hit    = { hit, objectId, region, point, normal, distance }
 *   region = 'hull' | 'pocket' | null
 *   accept.objectId may be a string or a string[]
 *   accept.objectId matches as a PREFIX: box_hull matches box_hull_80x40x20
 *   accept.region, when set, must equal hit.region exactly
 *
 * Usage: node replay/grade-check.js
 */

import { gradeHit, objectIdMatches, DEFAULT_NORMAL_TOLERANCE } from '../src/grade.js';

const checks = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok });
  console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

const hullHit = (objectId = 'box_hull_80x40x20') => ({
  hit: true, objectId, region: 'hull',
  point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 5,
});
const pocketHit = (objectId = 'box_hull_80x40x20') => ({ ...hullHit(objectId), region: 'pocket' });
const noRegionHit = (objectId = 'box_hull_80x40x20') => ({ ...hullHit(objectId), region: null });

console.log('--- objectId: exact, prefix, and array ---');
check('exact id matches', gradeHit({ objectId: 'box_hull' }, hullHit('box_hull')), 'pass');
check('prefix matches the instance name', gradeHit({ objectId: 'box_hull' }, hullHit('box_hull_80x40x20')), 'pass');
check('a different part fails', gradeHit({ objectId: 'box_hull' }, hullHit('CTH_fixture_a')), 'fail');
check('array, first entry matches', gradeHit({ objectId: ['box_hull', 'CTH_fixture'] }, hullHit('box_hull_80x40x20')), 'pass');
check('array, second entry matches', gradeHit({ objectId: ['box_hull', 'CTH_fixture'] }, hullHit('CTH_fixture_01')), 'pass');
check('array, no entry matches', gradeHit({ objectId: ['box_hull', 'CTH_fixture'] }, hullHit('scrap_plate')), 'fail');
check('a longer hit id is not a prefix of a longer accept', gradeHit({ objectId: 'box_hull_80x40x20' }, hullHit('box_hull')), 'fail');
check('empty-string id never matches', objectIdMatches('', 'box_hull'), false);
check('empty array never matches', objectIdMatches([], 'box_hull'), false);
check('non-string hit id never matches', objectIdMatches('box_hull', undefined), false);

console.log('\n--- region: exact, and required means required ---');
check('region matches', gradeHit({ objectId: 'box_hull', region: 'hull' }, hullHit()), 'pass');
check('wrong region fails even with the right id', gradeHit({ objectId: 'box_hull', region: 'hull' }, pocketHit()), 'fail');
check('pocket accept matches a pocket hit', gradeHit({ objectId: 'box_hull', region: 'pocket' }, pocketHit()), 'pass');
check('pocket accept rejects a hull hit', gradeHit({ objectId: 'box_hull', region: 'pocket' }, hullHit()), 'fail');
// The important one: an adapter that forgot to emit region must not pass.
check('null region cannot satisfy a region accept', gradeHit({ objectId: 'box_hull', region: 'hull' }, noRegionHit()), 'fail');
check('missing region key cannot satisfy a region accept', gradeHit({ objectId: 'box_hull', region: 'hull' }, { hit: true, objectId: 'box_hull' }), 'fail');
check('no region accept ignores region entirely', gradeHit({ objectId: 'box_hull' }, pocketHit()), 'pass');
check('region-only accept is honoured', gradeHit({ region: 'pocket' }, pocketHit()), 'pass');
check('region-only accept still rejects', gradeHit({ region: 'pocket' }, hullHit()), 'fail');

console.log('\n--- misses and empty accepts ---');
check('no hit is a miss whatever the accept', gradeHit({ objectId: 'box_hull', region: 'hull' }, { hit: false }), 'miss');
check('null hit is a miss', gradeHit({ objectId: 'box_hull' }, null), 'miss');
check('empty accept passes any hit', gradeHit({}, hullHit()), 'pass');
check('null accept passes any hit', gradeHit(null, hullHit()), 'pass');

console.log('\n--- normals still behave, alongside region ---');
const offAxis = { ...hullHit(), normal: { x: 0, y: 0.7071, z: 0.7071 } };
check('normal within default tolerance passes', gradeHit({ objectId: 'box_hull', normals: [[0, 1, 0]] }, hullHit()), 'pass');
check('normal outside default tolerance fails', gradeHit({ objectId: 'box_hull', normals: [[0, 1, 0]] }, offAxis), 'fail');
check('loosened tolerance accepts it', gradeHit({ objectId: 'box_hull', normals: [[0, 1, 0]], normalTolerance: 0.5 }, offAxis), 'pass');
// normals must be checked even with no objectId — the previous shape returned
// 'pass' before looking at them whenever objectId was absent.
check('normals-only accept is honoured', gradeHit({ normals: [[0, 1, 0]] }, offAxis), 'fail');
check('region and normals are both required when both are set', gradeHit({ region: 'hull', normals: [[0, 1, 0]] }, { ...offAxis, region: 'hull' }), 'fail');
check('default tolerance is 0.95', DEFAULT_NORMAL_TOLERANCE, 0.95);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} contract checks passed`);
if (failed.length) process.exit(1);
