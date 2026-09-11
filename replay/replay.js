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
import { gradeHit } from '../src/grade.js';

const APP_URL = process.env.APP_URL || 'http://localhost:5174/demo/';
const fixturePath = process.argv[2];

if (!fixturePath) {
  console.error('Usage: node replay.js <fixture.json>');
  process.exit(2);
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// An entry may declare the grade it is SUPPOSED to produce via `expect`
// ('pass' when absent). fixtures/negative-controls.json uses this to assert
// that deliberately mismatched data really does come back 'fail'/'miss' —
// without that, a grader that had become too permissive would show green, and
// a fixture full of genuine failures would spam issues on every CI run.
// An entry is a problem only when its actual grade differs from `expect`.
function expectationOf(entry) {
  return entry.expect || 'pass';
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

    const result = gradeHit(original.expected, hit);
    const expectation = expectationOf(original);
    const asExpected = result === expectation;

    // `hit` is what the issue body should report — the ORIGINAL entry's `hit`
    // is the recorded (passing) result, which would be actively misleading.
    outcomes.push({
      ...original,
      recordedHit: original.hit,
      hit,
      replayHit: hit,
      result,
      expectedResult: expectation,
      asExpected,
    });

    if (expectation === 'pass') {
      console.log(`${result.padEnd(6)} ${original.testId} — ${original.title}`);
    } else {
      const tag = asExpected ? 'ok' : 'BROKEN';
      console.log(`${tag.padEnd(6)} ${original.testId} — ${original.title}  [negative control: expected ${expectation}, got ${result}]`);
    }
  }

  await browser.close();

  const failing = outcomes.filter((o) => !o.asExpected);
  const negatives = outcomes.filter((o) => o.expectedResult !== 'pass').length;
  console.log(
    `\n${outcomes.length - failing.length}/${outcomes.length} as expected` +
    (negatives ? ` (${negatives} of them negative controls)` : ''),
  );

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
