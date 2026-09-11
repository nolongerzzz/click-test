#!/usr/bin/env node
/**
 * click-test-harness / replay / replay.js
 *
 * Re-plays previously recorded fixtures (camera + screen click + expected
 * hit) against your actual running app and asserts the raycast result still
 * matches. This is the piece that turns a one-time manual click session
 * into a permanent regression test.
 *
 * IMPORTANT: this does NOT synthesize DOM pointer events into the canvas
 * (WebGL canvases are notoriously unreliable to click-simulate headlessly).
 * Instead it calls the host adapter's own functions directly — the same
 * `window.__CTH_HOST__` hooks your app already exposes for the interactive
 * harness (see src/three-adapter.js). That's what "wiring in" means here:
 * your app just needs to load the adapter, nothing else changes.
 *
 * Usage:
 *   APP_URL=http://localhost:5174/demo/ node replay/replay.js fixtures/example.json
 *
 * Env vars (only needed to auto-file issues on failure):
 *   GITHUB_TOKEN        - provided automatically inside GitHub Actions
 *   GITHUB_REPOSITORY   - "owner/repo", also provided automatically in Actions
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileIssuesForFailures } from './github-issues.js';

const APP_URL = process.env.APP_URL || 'http://localhost:5174/demo/';
const fixturePath = process.argv[2];

if (!fixturePath) {
  console.error('Usage: node replay.js <fixture.json>');
  process.exit(2);
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

function gradeReplay(expected, hit) {
  if (!hit || !hit.hit) return 'miss';
  if (!expected || !expected.objectId) return 'pass';
  if (hit.objectId !== expected.objectId) return 'fail';
  if (expected.normals && expected.normals.length) {
    const hn = hit.normal;
    if (!hn) return 'fail';
    const ok = expected.normals.some(([nx, ny, nz]) => (hn.x * nx + hn.y * ny + hn.z * nz) > 0.95);
    return ok ? 'pass' : 'fail';
  }
  return 'pass';
}

async function main() {
  const browser = await chromium.launch();
  // Size the page to the canvas the fixture was recorded against. The replayed
  // NDC coordinates are resolution-independent, but the app's own resize
  // handler derives camera.aspect from the viewport — replaying at a different
  // size would aim the same NDC at a different ray. (setCameraState also
  // restores the recorded aspect; this keeps the page itself consistent.)
  const first = fixture.results.find((r) => r.clickScreen);
  const viewport = first && first.clickScreen.canvasWidth
    ? { width: Math.round(first.clickScreen.canvasWidth), height: Math.round(first.clickScreen.canvasHeight) }
    : { width: 1280, height: 800 };
  const page = await browser.newPage({ viewport });
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__CTH_HOST__ != null', null, { timeout: 15000 });

  // See record.js — surface a silent CDN fallback rather than hiding it.
  console.log(`three loaded from: ${await page.evaluate(() => window.__CTH_THREE_SOURCE__ || 'unknown')}`);

  const outcomes = [];

  for (const original of fixture.results) {
    if (!original.camera || !original.clickScreen) continue; // skip skipped/incomplete entries

    const hit = await page.evaluate(({ camera, clickScreen }) => {
      window.__CTH_HOST__.setCameraState(camera);
      return window.__CTH_HOST__.raycastAtScreenPoint(clickScreen);
    }, { camera: original.camera, clickScreen: original.clickScreen });

    const result = gradeReplay(original.expected, hit);
    // `hit` is what the issue body should report — the ORIGINAL entry's `hit`
    // is the recorded (passing) result, which would be actively misleading.
    outcomes.push({ ...original, recordedHit: original.hit, hit, replayHit: hit, result });
    console.log(`${result.padEnd(6)} ${original.testId} — ${original.title}`);
  }

  await browser.close();

  const failing = outcomes.filter((o) => o.result === 'fail' || o.result === 'miss');
  const pass = outcomes.length - failing.length;
  console.log(`\n${pass}/${outcomes.length} passed`);

  if (outcomes.length === 0) {
    console.error(`No replayable entries in ${fixturePath} (every result lacked camera/clickScreen data).`);
    process.exit(2);
  }

  if (failing.length && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    // Never let an issue-filing problem (fork PR with a read-only token, rate
    // limit, network) mask the actual test result we came here to report.
    try {
      const { created, commented } = await fileIssuesForFailures({
        entries: failing,
        owner,
        repo,
        token: process.env.GITHUB_TOKEN,
      });
      console.log(`Filed ${created} new issue(s), updated ${commented} existing.`);
    } catch (err) {
      console.error(`Could not file issues for the failures above: ${err.message}`);
    }
  }

  process.exit(failing.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
