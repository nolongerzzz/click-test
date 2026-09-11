#!/usr/bin/env node
/**
 * click-test-harness / replay / self-test.js
 *
 * One command that exercises the whole stack against the toolkit's own demo:
 * serve the repo, record a fixture by driving the demo with real simulated
 * clicks (record.js), then verify that fixture still resolves identically
 * through the host hooks (replay.js). No external app, no human clicking.
 *
 * The server has to cover the repo ROOT, not just demo/ — demo/index.html
 * imports ../src/*.js, which is outside the demo folder.
 *
 * Usage:
 *   npm run self-test
 *   APP_URL=http://localhost:5174/demo/ node replay/self-test.js   # reuse a running server
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5174);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}/demo/`;
const FIXTURE = process.argv[2] || 'fixtures/self-test.json';
const EXTERNAL_SERVER = Boolean(process.env.APP_URL);

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  let server = null;

  if (!EXTERNAL_SERVER) {
    const serveBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'serve.cmd' : 'serve');
    server = spawn(serveBin, ['.', '-l', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    server.on('error', (err) => {
      console.error(`Could not start the static server (${serveBin}). Did you run npm install?\n${err.message}`);
      process.exit(1);
    });
  }

  const stop = () => { if (server && !server.killed) server.kill('SIGTERM'); };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });

  try {
    await waitForServer(APP_URL);
    console.log(`\n--- record: driving ${APP_URL} with simulated clicks ---`);
    await run(process.execPath, ['replay/record.js', FIXTURE], { APP_URL });
    console.log(`\n--- replay: re-resolving ${FIXTURE} through the host hooks ---`);
    await run(process.execPath, ['replay/replay.js', FIXTURE], { APP_URL });
    console.log('\nSelf-test passed.');
  } finally {
    stop();
  }
}

main().catch((err) => {
  console.error(`\nSelf-test failed: ${err.message}`);
  process.exit(1);
});
