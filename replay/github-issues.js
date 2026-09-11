/**
 * click-test-harness / replay / github-issues
 *
 * Tier 2 issue filing: fully automatic, called from CI after a headless
 * replay run. Requires a token with `issues:write` — in GitHub Actions,
 * the built-in GITHUB_TOKEN is enough, no secret to set up manually.
 *
 * Dedupe: before filing, we look for an open issue carrying the hidden
 * `<!-- click-test:{testId} -->` tag (the same tag the manual "File issue"
 * button embeds) so re-running CI on an already-known failure comments on it
 * instead of spawning a duplicate ticket.
 *
 * The lookup LISTS issues by label and matches the tag exactly, rather than
 * relying on the search API, for two reasons:
 *   1. Search tokenizes punctuation away, so a quoted `<!-- click-test:x -->`
 *      phrase neither matches reliably nor matches only that tag.
 *   2. The search index lags issue creation by up to a minute, so two CI runs
 *      in quick succession would each file their own "new" issue — exactly the
 *      duplicate spam this is meant to prevent.
 * Search is kept only as a fallback for issues that lost the label.
 */

const API = 'https://api.github.com';
const LABELS = ['click-test', 'bug'];
const MAX_LABEL_PAGES = 10; // 100 issues/page — far more than a sane backlog

function issueTag(testId) {
  return `<!-- click-test:${testId} -->`;
}

async function githubFetch(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${options.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function findExistingIssue({ owner, repo, token, testId }) {
  const tag = issueTag(testId);

  for (let page = 1; page <= MAX_LABEL_PAGES; page++) {
    const issues = await githubFetch(
      `/repos/${owner}/${repo}/issues?state=open&labels=click-test&per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(issues) || issues.length === 0) break;
    // This endpoint returns PRs alongside issues; pull_request marks those.
    const match = issues.find((i) => !i.pull_request && typeof i.body === 'string' && i.body.includes(tag));
    if (match) return match;
    if (issues.length < 100) break;
  }

  // Fallback for an issue whose label was removed by hand. Best-effort only:
  // verify the tag really is in the body rather than trusting the match.
  try {
    const q = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open "click-test:${testId}"`);
    const result = await githubFetch(`/search/issues?q=${q}&advanced_search=true`, token);
    const items = (result && result.items) || [];
    return items.find((i) => typeof i.body === 'string' && i.body.includes(tag)) || null;
  } catch {
    return null; // search unavailable (rate limit, permissions) — treat as "not found"
  }
}

function buildBody(entry) {
  // entry.hit is the REPLAY result (what CI just got). entry.recordedHit is
  // what the fixture captured when the test passed — showing both is what
  // makes the issue actionable, and reporting only the recorded hit (which is
  // by definition the passing one) would be actively misleading.
  return [
    issueTag(entry.testId),
    '',
    `**Test:** ${entry.testId} — ${entry.title}`,
    `**Result:** ${entry.result}`,
    ...(entry.expectedResult && entry.expectedResult !== 'pass'
      ? [`**Negative control regression:** this entry is supposed to grade \`${entry.expectedResult}\`, but graded \`${entry.result}\`. The grading rules in \`src/grade.js\` have most likely become too permissive — do not "fix" the fixture.`]
      : []),
    `**Expected object:** \`${entry.expected ? entry.expected.objectId : 'n/a'}\``,
    `**Got now:** \`${entry.hit ? JSON.stringify(entry.hit) : 'no hit'}\``,
    `**Recorded in fixture:** \`${entry.recordedHit ? JSON.stringify(entry.recordedHit) : 'n/a'}\``,
    '',
    'Filed automatically by the click-test replay CI run.',
    '',
    '**Replay data:**',
    '```json',
    JSON.stringify({ camera: entry.camera, clickScreen: entry.clickScreen }, null, 2),
    '```',
  ].join('\n');
}

/**
 * @param entries  failing/missed result entries from the replay run
 * @param owner, repo, token  GitHub target + auth
 * @returns {Promise<{created: number, commented: number}>}
 */
export async function fileIssuesForFailures({ entries, owner, repo, token }) {
  let created = 0, commented = 0;

  for (const entry of entries) {
    const existing = await findExistingIssue({ owner, repo, token, testId: entry.testId });
    if (existing) {
      await githubFetch(`/repos/${owner}/${repo}/issues/${existing.number}/comments`, token, {
        method: 'POST',
        body: JSON.stringify({ body: `Still failing as of this run.\n\n${buildBody(entry)}` }),
      });
      commented++;
    } else {
      await githubFetch(`/repos/${owner}/${repo}/issues`, token, {
        method: 'POST',
        body: JSON.stringify({
          title: `[click-test] ${entry.title} — ${entry.result}`,
          body: buildBody(entry),
          labels: LABELS,
        }),
      });
      created++;
    }
  }

  return { created, commented };
}
