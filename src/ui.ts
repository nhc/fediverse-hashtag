/**
 * The web interface. Four pages, server-rendered, no client framework.
 *
 * The layout decision that matters: the coverage panel sits beside the numbers
 * rather than below them. A count and its caveat should be read together,
 * because a caveat placed underneath gets scrolled past and then the number
 * travels on its own.
 */

const STYLE = `
:root {
  --bg: #fbfaf8; --panel: #ffffff; --ink: #1c1a17; --muted: #6b6559;
  --line: #e2ded6; --accent: #3f6f52; --warn: #8a5a2b; --thin: #8a3b3b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161513; --panel: #1e1d1a; --ink: #ece8e1; --muted: #9c948a;
    --line: #302e2a; --accent: #8fbfa1; --warn: #d1a06a; --thin: #d68b8b;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 62rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
a { color: var(--accent); }
h1 { font-size: 1.6rem; margin: 0 0 .4rem; letter-spacing: -.01em; }
h2 { font-size: 1.1rem; margin: 2rem 0 .75rem; }
.statement { color: var(--muted); font-size: .95rem; margin: 0 0 1.75rem; max-width: 46rem; }
nav { border-bottom: 1px solid var(--line); }
nav div { max-width: 62rem; margin: 0 auto; padding: .9rem 1.25rem; display: flex; gap: 1.25rem; font-size: .9rem; }
nav a { text-decoration: none; }
form { display: flex; gap: .5rem; margin: 0 0 1.5rem; max-width: 30rem; }
input[type=search] {
  flex: 1; padding: .6rem .75rem; font-size: 1rem; color: var(--ink);
  background: var(--panel); border: 1px solid var(--line); border-radius: .4rem;
}
button {
  padding: .6rem 1rem; font-size: 1rem; cursor: pointer; color: var(--bg);
  background: var(--accent); border: 0; border-radius: .4rem;
}
.layout { display: grid; grid-template-columns: minmax(0,1fr) 17rem; gap: 1.5rem; align-items: start; }
@media (max-width: 44rem) { .layout { grid-template-columns: minmax(0,1fr); } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: .6rem; padding: 1rem 1.15rem; }
.windows { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; }
.metric { background: var(--panel); border: 1px solid var(--line); border-radius: .6rem; padding: .9rem 1rem; }
.metric .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.metric .value { font-size: 1.9rem; font-variant-numeric: tabular-nums; line-height: 1.2; }
.metric .sub { font-size: .8rem; color: var(--muted); }
.trend-up { color: var(--accent); } .trend-down { color: var(--warn); }
.unavailable { color: var(--muted); font-style: italic; }
.q-good { color: var(--accent); } .q-partial { color: var(--warn); } .q-thin { color: var(--thin); }
dl { margin: 0; font-size: .875rem; }
dt { color: var(--muted); margin-top: .6rem; }
dd { margin: 0; }
table { width: 100%; border-collapse: collapse; font-size: .875rem; }
th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.scroll { overflow-x: auto; }
.note { font-size: .85rem; color: var(--muted); }
ul.limits { padding-left: 1.1rem; font-size: .9rem; color: var(--muted); }
ul.limits li { margin: .35rem 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--line); font-size: .85rem; color: var(--muted); }
`;

/**
 * Escape for HTML.
 *
 * Takes unknown rather than string on purpose. A field arriving undefined
 * through a cast should render as empty text, not throw and take the whole page
 * down with a 500. That is exactly how the first version of the tag page broke:
 * a snake_case API field cast to a camelCase type.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function layout(title: string, body: string, statement: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<nav><div>
  <a href="/">Search</a>
  <a href="/coverage">Coverage and methodology</a>
  <a href="/status">Status</a>
  <a href="/api/v1/meta">API</a>
</div></nav>
<main>
${body}
<footer>
  <p>${escapeHtml(statement)}</p>
  <p>This index cannot see the whole Fediverse, and does not claim to.
     <a href="/coverage">What it can and cannot see</a>.</p>
</footer>
</main>
</body>
</html>`;
}

export function html(body: string, status = 200, cacheSeconds = 15): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${cacheSeconds}`,
    },
  });
}

function formatCount(value: number): string {
  return value.toLocaleString('en-GB');
}

function formatTrend(value: number | null, comparable: boolean): string {
  if (value === null) {
    return comparable
      ? '<span class="unavailable">no comparison</span>'
      : '<span class="unavailable">coverage changed, not compared</span>';
  }
  const pct = Math.round(value * 1000) / 10;
  const klass = pct >= 0 ? 'trend-up' : 'trend-down';
  return `<span class="${klass}">${pct >= 0 ? '+' : ''}${pct}%</span> on previous`;
}

export function searchPage(statement: string): string {
  return layout(
    'Fediverse Hashtag Activity Index',
    `<h1>Fediverse hashtag activity</h1>
<p class="statement">${escapeHtml(statement)} It is not a count of hashtag use across
the Fediverse, because no server holds a complete view of the network.</p>
<form action="/tag" method="get">
  <input type="search" name="q" placeholder="cats" aria-label="Hashtag" required>
  <button type="submit">Look up</button>
</form>
<p class="note">Searching a hashtag this index does not yet track will start it
tracking, and show the daily counters servers keep about themselves in the
meantime.</p>`,
    statement,
  );
}

interface WindowView {
  key: string;
  postsObserved: number;
  authorsObserved: number;
  trend: number | null;
  coverageComparable: boolean;
}

export interface TagView {
  tag: string;
  display: string;
  asOf: string;
  tier: string;
  pollIntervalSeconds: number;
  windows: WindowView[];
  instancesMonitored: number;
  instancesReporting: number;
  medianInstancesPerPost: number | null;
  quality: 'good' | 'partial' | 'thin';
  uniqueOriginServers: number;
  lastSuccessfulUpdate: string | null;
  origins: { host: string; postsObserved: number }[];
  posts: { url: string; createdAt: string; originHost: string }[];
  series: { at: string; postsObserved: number }[];
  dailyCounters: { host: string; day: string; uses: number; accounts: number }[] | null;
  statement: string;
}

const WINDOW_LABELS: Record<string, string> = {
  '5m': 'Last 5 minutes',
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
};

const QUALITY_TEXT: Record<TagView['quality'], string> = {
  good: 'A typical post here reached most monitored servers, so this count is reasonably solid.',
  partial: 'A typical post here reached some monitored servers. Read this count as incomplete.',
  thin: 'A typical post here reached very few monitored servers. Read this count as a lower bound.',
};

/** A sparkline, drawn inline so the page needs no scripting and no libraries. */
export function sparkline(series: readonly { postsObserved: number }[], width = 560, height = 90): string {
  if (series.length < 2) return '<p class="note">Not enough history yet to draw a chart.</p>';

  const peak = Math.max(...series.map((point) => point.postsObserved), 1);
  const step = width / (series.length - 1);
  const points = series
    .map((point, index) => {
      const x = Math.round(index * step * 10) / 10;
      const y = Math.round((height - (point.postsObserved / peak) * (height - 4) - 2) * 10) / 10;
      return `${x},${y}`;
    })
    .join(' ');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img"
   aria-label="Posts observed per minute over the last 24 hours, peak ${peak}">
  <polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"
    points="${points}" opacity="0.85"/>
</svg>
<p class="note">Posts observed per minute, last 24 hours. Peak ${formatCount(peak)}.</p>`;
}

export function tagPage(view: TagView): string {
  const metrics = view.windows
    .map(
      (window) => `<div class="metric">
  <div class="label">${escapeHtml(WINDOW_LABELS[window.key] ?? window.key)}</div>
  <div class="value">${formatCount(window.postsObserved)}</div>
  <div class="sub">posts observed, ${formatCount(window.authorsObserved)} authors</div>
  <div class="sub">${formatTrend(window.trend, window.coverageComparable)}</div>
</div>`,
    )
    .join('\n');

  const originRows = view.origins
    .map(
      (origin) =>
        `<tr><td>${escapeHtml(origin.host)}</td><td class="num">${formatCount(origin.postsObserved)}</td></tr>`,
    )
    .join('\n');

  const postItems = view.posts
    .map(
      (post) =>
        `<tr><td><a href="${escapeHtml(post.url)}" rel="nofollow noopener">${escapeHtml(post.originHost)}</a></td>
         <td class="num">${escapeHtml(post.createdAt.slice(11, 16))}</td></tr>`,
    )
    .join('\n');

  const daily =
    view.dailyCounters === null
      ? ''
      : `<h2>Daily counters from the servers themselves</h2>
<p class="note">This index has not collected a window for this hashtag yet, so these are
the servers own daily counts. Instance-local, daily granularity, and not comparable
with the figures above.</p>
<div class="scroll"><table>
<thead><tr><th>Server</th><th>Day</th><th class="num">Uses</th><th class="num">Accounts</th></tr></thead>
<tbody>${view.dailyCounters
          .map(
            (entry) =>
              `<tr><td>${escapeHtml(entry.host)}</td><td>${escapeHtml(entry.day)}</td>
               <td class="num">${formatCount(entry.uses)}</td>
               <td class="num">${formatCount(entry.accounts)}</td></tr>`,
          )
          .join('\n')}</tbody>
</table></div>`;

  return layout(
    `#${view.display} activity`,
    `<h1>#${escapeHtml(view.display)}</h1>
<p class="statement">${escapeHtml(view.statement)}</p>

<div class="layout">
  <div>
    <div class="windows">${metrics}</div>
    <h2>Activity over time</h2>
    <div class="panel">${sparkline(view.series)}</div>

    <h2>Where these posts came from</h2>
    ${
      view.origins.length === 0
        ? '<p class="note">No posts observed for this hashtag in the last 24 hours.</p>'
        : `<div class="scroll"><table>
      <thead><tr><th>Origin server</th><th class="num">Posts observed</th></tr></thead>
      <tbody>${originRows}</tbody></table></div>`
    }

    <h2>Recent posts</h2>
    <p class="note">Links only. This index stores no post content, so a deleted post
    becomes a dead link rather than a copy. Posts marked sensitive are excluded.</p>
    ${
      view.posts.length === 0
        ? '<p class="note">Nothing to link to yet.</p>'
        : `<div class="scroll"><table>
      <thead><tr><th>Origin</th><th class="num">Time</th></tr></thead>
      <tbody>${postItems}</tbody></table></div>`
    }
    ${daily}
  </div>

  <aside class="panel">
    <h2 style="margin-top:0">Coverage</h2>
    <p class="${`q-${view.quality}`}" style="font-size:.875rem">${escapeHtml(QUALITY_TEXT[view.quality])}</p>
    <dl>
      <dt>Servers seeing a typical post</dt>
      <dd>${
        view.medianInstancesPerPost === null
          ? '<span class="unavailable">nothing observed yet</span>'
          : `${view.medianInstancesPerPost} of ${view.instancesMonitored} monitored`
      }</dd>
      <dt>Servers reporting</dt>
      <dd>${view.instancesReporting} of ${view.instancesMonitored}</dd>
      <dt>Distinct origin servers</dt>
      <dd>${formatCount(view.uniqueOriginServers)}</dd>
      <dt>Polled every</dt>
      <dd>${view.pollIntervalSeconds < 60 ? `${view.pollIntervalSeconds} seconds` : `${view.pollIntervalSeconds / 60} minutes`} (${escapeHtml(view.tier)} tier)</dd>
      <dt>Last successful update</dt>
      <dd>${
        view.lastSuccessfulUpdate === null
          ? '<span class="unavailable">never</span>'
          : escapeHtml(view.lastSuccessfulUpdate.slice(0, 19).replace('T', ' ')) + ' UTC'
      }</dd>
    </dl>
    <p class="note" style="margin-bottom:0"><a href="/coverage">How these figures are produced</a></p>
  </aside>
</div>`,
    view.statement,
  );
}

export interface CoverageView {
  statement: string;
  contact: string;
  userAgent: string;
  serversByCapability: Record<string, string[]>;
  capabilityMeanings: Record<string, string>;
  limitations: string[];
}

export function coveragePage(view: CoverageView): string {
  const groups = Object.entries(view.serversByCapability)
    .map(
      ([capability, hosts]) => `<h2>${escapeHtml(capability)} (${hosts.length})</h2>
<p class="note">${escapeHtml(view.capabilityMeanings[capability] ?? '')}</p>
<p>${hosts.length === 0 ? '<span class="unavailable">none</span>' : hosts.map((host) => `<code>${escapeHtml(host)}</code>`).join(', ')}</p>`,
    )
    .join('\n');

  return layout(
    'Coverage and methodology',
    `<h1>Coverage and methodology</h1>
<p class="statement">${escapeHtml(view.statement)}</p>

<h2>Why a complete count is impossible</h2>
<p>The Fediverse has no centre. Each server knows about posts its own members wrote,
plus posts that reached it because somebody there follows the author, or because a
relay forwarded them. Two servers looking at the same hashtag see overlapping but
different sets of posts.</p>
<p>So this index reads several well-connected servers and merges what they report.
That gives a broad view. It is not a complete one, and the shortfall cannot be
estimated reliably, because the size of what is missing is exactly the thing no
server can see.</p>
<p>Reading one hashtag from three servers at the same moment returned 40 posts from
any single server and 50 unique posts from all three together. Adding servers keeps
finding more, with diminishing returns and no point at which the curve is known to
have finished.</p>

<h2>How coverage is shown</h2>
<p>Every count is published with the number of servers monitored, the number
reporting successfully, which servers contributed, the median number of servers that
saw each post, and the time of the last successful update.</p>
<p>That median is the most useful number on a tag page. If a typical post was seen by
six of eight monitored servers, the index is watching the well-connected middle of the
network. If most posts were seen by one server, it is catching fragments, and the
count should be read as a lower bound.</p>

<h2>What is counted</h2>
<p>Public posts only, meaning posts a logged-out visitor could read on the origin
server. Unlisted, followers-only and direct posts are excluded, as are posts from
servers that have opted out. Windows are cut on the post's own timestamp, not on when
this index saw it.</p>
<p>Author counts are exact for what was observed, and are produced without keeping a
list of authors. Each handle is hashed with a secret salt before storage, which gives a
stable key for counting distinct people and nothing that identifies them.</p>

<h2>Trends</h2>
<p>A trend compares a window against the window immediately before it. That comparison
only holds if the index saw about as much in both periods, so when servers were
unreachable during either window no trend is shown at all. An absent trend means the
comparison could not be made honestly, not that activity was flat.</p>

<h2>Monitored servers</h2>
<p class="note">Capability is probed per server and re-probed weekly. It is never
inferred from software version, because version does not predict it: a server running a
4.8 development build was found refusing requests that 4.7.0 servers allowed.</p>
${groups}

<h2>Known limitations</h2>
<ul class="limits">${view.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')}</ul>

<h2>Opting out</h2>
<p><strong>Servers.</strong> Email <code>${escapeHtml(view.contact)}</code>, or serve a
<code>robots.txt</code> disallowing <code>${escapeHtml(view.userAgent.split('/')[0] ?? '')}</code>.
Polling stops on the next collection tick, and observations attributed to the server are
removed at the next retention sweep. The server is then listed here as opted out, so its
absence is visible rather than silent.</p>
<p><strong>Authors.</strong> Email the same address. The handle is hashed and added to a
suppression list holding hashes only, and existing observations matching it are deleted.
An author whose handle changes will need to ask again.</p>
<p class="note">The collector identifies itself on every request as
<code>${escapeHtml(view.userAgent)}</code> and is never disguised.</p>`,
    view.statement,
  );
}

export interface StatusView {
  statement: string;
  asOf: string;
  instances: {
    host: string;
    capability: string;
    optedOut: boolean;
    lastSuccessfulPoll: string | null;
    consecutiveFailures: number;
    pausedUntil: string | null;
    polls: number;
    failures: number;
    meanLatencyMs: number | null;
    lowestHeadroom: number | null;
  }[];
}

export function statusPage(view: StatusView): string {
  const rows = view.instances
    .map((instance) => {
      const state = instance.optedOut
        ? '<span class="unavailable">opted out</span>'
        : instance.pausedUntil !== null
          ? `<span class="q-partial">paused</span>`
          : instance.consecutiveFailures > 0
            ? `<span class="q-thin">failing (${instance.consecutiveFailures})</span>`
            : '<span class="q-good">ok</span>';
      return `<tr>
  <td><code>${escapeHtml(instance.host)}</code></td>
  <td>${escapeHtml(instance.capability)}</td>
  <td>${state}</td>
  <td class="num">${instance.polls}</td>
  <td class="num">${instance.failures}</td>
  <td class="num">${instance.meanLatencyMs === null ? '&mdash;' : `${instance.meanLatencyMs} ms`}</td>
  <td class="num">${instance.lowestHeadroom === null ? '&mdash;' : instance.lowestHeadroom}</td>
  <td class="num">${
    instance.lastSuccessfulPoll === null
      ? '<span class="unavailable">never</span>'
      : escapeHtml(instance.lastSuccessfulPoll.slice(11, 16))
  }</td>
</tr>`;
    })
    .join('\n');

  return layout(
    'Collector status',
    `<h1>Collector status</h1>
<p class="statement">Published because an index making claims about its coverage should
show its own failures. Figures cover the last hour. As of
${escapeHtml(view.asOf.slice(0, 19).replace('T', ' '))} UTC.</p>
<div class="scroll"><table>
<thead><tr>
  <th>Server</th><th>Capability</th><th>State</th>
  <th class="num">Polls</th><th class="num">Failures</th>
  <th class="num">Mean latency</th><th class="num">Lowest headroom</th><th class="num">Last ok</th>
</tr></thead>
<tbody>${rows}</tbody>
</table></div>
<p class="note">Headroom is the lowest <code>x-ratelimit-remaining</code> a server
reported in the last hour. The collector pauses a server before that reaches zero
rather than waiting to be refused.</p>`,
    view.statement,
  );
}

export function notFoundPage(statement: string): string {
  return layout(
    'Not found',
    `<h1>Not found</h1><p class="statement">There is nothing at this address.
<a href="/">Search for a hashtag</a>.</p>`,
    statement,
  );
}
