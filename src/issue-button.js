/**
 * click-test-harness / issue-button
 *
 * Tier 1 issue filing: no token, no backend. Builds a prefilled
 * "github.com/OWNER/REPO/issues/new" URL and opens it — the user reviews
 * and hits submit themselves. Safe to ship in a public/hosted demo since
 * nobody's credentials are involved.
 *
 * A hidden HTML-comment tag is embedded in the body so that, if this
 * failure later gets auto-filed by the CI pipeline too (see replay/github-issues.js),
 * both paths use the same dedupe key and won't create duplicate tickets.
 */

export function issueTag(entry) {
  return `<!-- click-test:${entry.testId} -->`;
}

export function buildIssueUrl({ owner, repo, entry }) {
  const title = `[click-test] ${entry.title} — ${entry.result}`;
  const body = [
    issueTag(entry),
    '',
    `**Test:** ${entry.testId}`,
    `**Result:** ${entry.result}`,
    `**Expected object:** \`${entry.expected ? entry.expected.objectId : 'n/a'}\``,
    `**Hit:** \`${entry.hit ? JSON.stringify(entry.hit) : 'none'}\``,
    '',
    '**Replay data** (camera + click point — paste into replay fixtures to reproduce):',
    '```json',
    JSON.stringify({ camera: entry.camera, clickScreen: entry.clickScreen }, null, 2),
    '```',
  ].join('\n');

  const params = new URLSearchParams({ title, body, labels: 'click-test,bug' });
  return `https://github.com/${owner}/${repo}/issues/new?${params.toString()}`;
}

/**
 * Renders a "File issue" button next to a failing/missed log row.
 * Call this per failing entry, or once with a "file all failures" button.
 */
export function renderFileIssueButton({ owner, repo, entry, container, label = 'File issue' }) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    window.open(buildIssueUrl({ owner, repo, entry }), '_blank', 'noopener');
  });
  container.appendChild(btn);
  return btn;
}
