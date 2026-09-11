#!/usr/bin/env node
/**
 * click-test-harness / replay / record.js
 *
 * Generates a fixture with no human clicking anything. For each test, it
 * reads the marker's real 3D position from the page, projects it through
 * the actual camera to a screen pixel, and dispatches a real click there —
 * the same DOM event a person tapping the screen would produce. The
 * in-page harness handles everything else exactly as it would for a human
 * (grading, advancing, logging).
 *
 * This is deliberately a *different* mechanism from replay.js:
 *   record.js  -> simulates a real user, to generate a fixture
 *   replay.js  -> calls the host hooks directly, to verify a fixture still
 *                 reproduces the same result (fast, no simulated input)
 * Running both back to back is the self-test: if record.js can complete
 * every test AND replay.js confirms every recorded click still resolves
 * the same way, the harness's own core logic (src/harness.js,
 * src/three-adapter.js) hasn't regressed.
 *
 * Usage:
 *   APP_URL=http://localhost:5174/demo/ node replay/record.js [outputPath]
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APP_URL = process.env.APP_URL || 'http://localhost:5174/demo/';
const VIEWPORT = { width: 1280, height: 800 };

// Orbit the camera by a fixed amount before each test (after the first), so the
// fixture captures a DIFFERENT camera pose per entry. Without this every entry
// shares the page's default pose, and replay.js would still "pass" even if
// setCameraState were completely broken — the very path it exists to protect.
// Deterministic on purpose: a fixture has to be reproducible.
// Deltas are deliberately modest and sign-alternating: large enough that every
// entry records a distinct pose, small enough that the accumulated orbit never
// swings past the viewpoint a test is authored for (the occlusion case only
// overlaps on screen from roughly the starting angle).
const ORBITS = [
  { dx: 0, dy: 0 },
  { dx: 18, dy: 8 },
  { dx: -14, dy: -6 },
  { dx: 12, dy: 10 },
  { dx: -20, dy: 5 },
  { dx: 16, dy: -9 },
  { dx: -10, dy: 10 },
];
const outputPath = process.argv[2] || 'fixtures/self-test.json';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__CTH_HOST__ != null && window.__CTH_HARNESS__ != null', null, { timeout: 15000 });

  // Report where three actually came from. The CDN fallback is otherwise
  // silent, so a CI run could be quietly exercising node_modules while
  // everyone assumes the import map is working.
  const threeSource = await page.evaluate(() => window.__CTH_THREE_SOURCE__ || 'unknown');
  console.log(`three loaded from: ${threeSource}`);

  const total = await page.evaluate(() => window.__CTH_HARNESS__.totalTests);
  let guard = 0;

  const canvasRect = await page.evaluate(() => {
    const r = document.querySelector('#viewport canvas').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const cx = canvasRect.left + canvasRect.width / 2;
  const cy = canvasRect.top + canvasRect.height / 2;

  // A drag longer than the harness's 6px threshold orbits the demo camera
  // without being graded as a click — the same way a human orbits.
  async function orbit({ dx, dy }) {
    if (!dx && !dy) return;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(50);
  }

  while (guard < total + 2) { // +2 slack in case a click misses and needs a retry path later
    guard++;
    const doneAlready = await page.evaluate(() => window.__CTH_HARNESS__.currentIndex >= window.__CTH_HARNESS__.totalTests);
    if (doneAlready) break;

    await orbit(ORBITS[(guard - 1) % ORBITS.length]);

    const target = await page.evaluate(() => {
      const pos = window.__CTH_HOST__.getMarkerPosition();
      if (!pos) return null;
      const ndc = window.__CTH_HOST__.projectToScreen(pos);
      const canvas = document.querySelector('#viewport canvas');
      const rect = canvas.getBoundingClientRect();
      return {
        xPix: rect.left + ((ndc.xNDC + 1) / 2) * rect.width,
        yPix: rect.top + (1 - (ndc.yNDC + 1) / 2) * rect.height,
        testId: window.__CTH_HARNESS__.currentTest ? window.__CTH_HARNESS__.currentTest.id : null,
      };
    });

    if (!target) {
      console.warn('No marker visible — skipping this test via the UI skip button.');
      await page.click('#skipBtn');
      continue;
    }

    const inCanvas =
      target.xPix >= canvasRect.left && target.xPix <= canvasRect.left + canvasRect.width &&
      target.yPix >= canvasRect.top && target.yPix <= canvasRect.top + canvasRect.height;
    if (!inCanvas) {
      console.error(`Marker for "${target.testId}" projected outside the canvas at (${Math.round(target.xPix)}, ${Math.round(target.yPix)}) — the orbit sequence moved it off screen.`);
      await browser.close();
      process.exit(1);
    }

    console.log(`Clicking test "${target.testId}" at (${Math.round(target.xPix)}, ${Math.round(target.yPix)})`);
    await page.mouse.move(target.xPix, target.yPix);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
  }

  const finished = await page.evaluate(() => window.__CTH_HARNESS__.currentIndex >= window.__CTH_HARNESS__.totalTests);
  const summary = await page.evaluate(() => window.__CTH_HARNESS__.getSummary());
  await browser.close();

  if (!finished) {
    console.error(`Recorder gave up after ${guard} iteration(s) with ${summary.results.length}/${total} test(s) answered.`);
    process.exit(1);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  console.log(`\nRecorded ${summary.results.length} test(s) -> ${outputPath}`);
  console.log(`${summary.summary.pass} pass, ${summary.summary.fail} fail, ${summary.summary.miss} miss`);

  if (summary.summary.fail > 0 || summary.summary.miss > 0 || summary.summary.skipped > 0) {
    console.error('Recorder produced fail/miss/skipped results — the demo scene or harness logic likely changed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
