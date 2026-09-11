#!/usr/bin/env node
/**
 * click-test-harness / replay / capture-check.js
 *
 * Proves the fix for the live-batch failure: a click on the mesh must not
 * start the host's model move, and must reach the harness as a pick.
 *
 * Runs two gestures against demo/capture-check.html, whose host deliberately
 * starts a drag on pointerdown over the canvas (registered BEFORE the harness,
 * the worst case):
 *
 *   1. NOT ARMED  — the host is expected to move the model and the harness is
 *                   expected to record nothing. This reproduces the reported
 *                   symptom, so a pass here means the check is really testing
 *                   something.
 *   2. ARMED      — the host must NOT move, and the harness must record a
 *                   graded pick.
 *
 * Usage: APP_URL=http://localhost:5174/demo/capture-check.html node replay/capture-check.js
 */

import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5174/demo/capture-check.html';

const checks = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok, actual, expected });
  console.log(`${ok ? 'ok    ' : 'FAILED'} ${name}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__CHECK__ != null', null, { timeout: 15000 });

  const centre = await page.evaluate(() => window.__CHECK__.centre());
  const click = async () => {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(120);
  };

  // --- 1. Not armed: the steal must still happen, or this check proves nothing.
  console.log('\n--- gesture 1: NOT armed (reproducing the reported steal) ---');
  const before = await page.evaluate(() => ({ x: window.__CHECK__.slabX(), n: window.__CHECK__.results().length }));
  await click();
  const afterUnarmed = await page.evaluate(() => ({
    moves: window.__CHECK__.moveCount(),
    x: window.__CHECK__.slabX(),
    results: window.__CHECK__.results().length,
  }));
  check('host moved the model when not armed', afterUnarmed.moves, 1);
  check('model actually slid', afterUnarmed.x > before.x, true);
  check('harness recorded nothing', afterUnarmed.results, before.n);

  // --- 2. Armed: the host must be locked out and the harness must get the pick.
  console.log('\n--- gesture 2: ARMED (pointerdown on mesh must not start a move) ---');
  await page.evaluate(() => window.__CHECK__.armOnce());
  check('harness reports armed', await page.evaluate(() => window.__CHECK__.isArmed()), true);
  const xBeforeArmed = await page.evaluate(() => window.__CHECK__.slabX());
  await click();
  const afterArmed = await page.evaluate(() => ({
    moves: window.__CHECK__.moveCount(),
    x: window.__CHECK__.slabX(),
    results: window.__CHECK__.results(),
    armed: window.__CHECK__.isArmed(),
  }));
  check('host did NOT move the model', afterArmed.moves, afterUnarmed.moves);
  check('model did not slide', afterArmed.x, xBeforeArmed);
  check('harness recorded exactly one pick', afterArmed.results.length, 1);
  check('the pick hit the mesh and graded pass', afterArmed.results[0] && afterArmed.results[0].result, 'pass');
  check('the pick resolved the right object', afterArmed.results[0] && afterArmed.results[0].hit && afterArmed.results[0].hit.objectId, 'box_hull');
  check('capture stood down after one pick', afterArmed.armed, false);

  // --- 3. Disarmed again: the host gets its input back, so orbiting still works.
  console.log('\n--- gesture 3: disarmed again (host input must be restored) ---');
  await click();
  const afterRelease = await page.evaluate(() => window.__CHECK__.moveCount());
  check('host input restored after the captured pick', afterRelease, afterArmed.moves + 1);

  // --- 4. A drag while armed must not be graded as a pick.
  console.log('\n--- gesture 4: armed, but dragged (must not grade) ---');
  await page.evaluate(() => window.__CHECK__.armOnce());
  const movesBeforeDrag = await page.evaluate(() => window.__CHECK__.moveCount());
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterDrag = await page.evaluate(() => ({
    moves: window.__CHECK__.moveCount(),
    results: window.__CHECK__.results().length,
    dragsIgnored: window.__CHECK__.dragsIgnored(),
  }));
  check('host still locked out during an armed drag', afterDrag.moves, movesBeforeDrag);
  check('armed drag was not graded as a pick', afterDrag.results, 1);
  check('armed drag was reported as an ignored drag', afterDrag.dragsIgnored, 1);

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
