/**
 * The web interface. Four pages, server-rendered, no client framework.
 *
 * The layout decision that matters: the coverage panel sits beside the numbers
 * rather than below them. A count and its caveat should be read together,
 * because a caveat placed underneath gets scrolled past and then the number
 * travels on its own.
 */

import {
  DEFAULT_FRAME,
  SHOUTING_THRESHOLD,
  logScale,
  logTicks,
  rhythmPath,
  scatterPoints,
  stripOrder,
  thresholdY,
  type ExploreTag,
} from './explore';

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

.chart { background: var(--panel); border: 1px solid var(--line); border-radius: .6rem; padding: 1rem; }
.chart svg { display: block; width: 100%; height: auto; }
.axis { stroke: var(--line); }
.axis-label { fill: var(--muted); font-size: 11px; }
.dot { cursor: pointer; transition: opacity .15s; }
.dot circle { fill: var(--accent); fill-opacity: .55; stroke: var(--accent); stroke-width: 1; }
.dot.tier-hot circle { fill: var(--warn); stroke: var(--warn); }
.dot.tier-cold circle { fill-opacity: .3; }
.dot text { fill: var(--ink); font-size: 11px; pointer-events: none; opacity: 0; }
.dot:hover text, .dot.active text { opacity: 1; }
.dot.dim { opacity: .2; }
.dot.active circle { fill-opacity: .9; stroke-width: 2; }
.threshold { stroke: var(--thin); stroke-dasharray: 4 4; }
.threshold-label { fill: var(--thin); font-size: 11px; }
.legend { display: flex; flex-wrap: wrap; gap: 1rem; font-size: .8rem; color: var(--muted); margin: .5rem 0 0; }
.legend span::before { content: ""; display: inline-block; width: .7rem; height: .7rem; border-radius: 50%; margin-right: .35rem; vertical-align: -.05rem; background: var(--accent); opacity: .6; }
.legend .hot::before { background: var(--warn); }
.legend .cold::before { opacity: .3; }
.strip { display: grid; grid-template-columns: 9rem minmax(0,1fr) 4rem; gap: 0 .75rem; align-items: center; font-size: .85rem; }
.strip > div { padding: .3rem 0; border-bottom: 1px solid var(--line); }
.strip .tag a { text-decoration: none; }
.strip .tag small { color: var(--muted); margin-left: .35rem; }
.strip svg { display: block; width: 100%; height: 28px; }
.strip polyline { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-linejoin: round; }
.strip .row-hot polyline { stroke: var(--warn); }
.strip .row-cold polyline { opacity: .5; }
.strip .peak { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
.strip .row.active > div { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.strip .row.dim { opacity: .35; }
.strip .hours { grid-column: 2; display: flex; justify-content: space-between; font-size: .7rem; color: var(--muted); border: 0; }
@media (max-width: 44rem) { .strip { grid-template-columns: 6rem minmax(0,1fr) 3rem; } }
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
  <a href="/tags">All tags</a>
  <a href="/explore">Explore</a>
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
meantime.</p>
<p>Or don't search. <a href="/tags">Browse every tag the index is watching</a>,
ranked by how many different people are using them, along with tags it has
discovered but is not yet polling.</p>`,
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
  tracked: boolean;
  capacityNote: string | null;
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

  const notTracked =
    view.tracked || view.capacityNote === null
      ? ''
      : `<div class="panel" style="border-color:var(--warn);margin-bottom:1.25rem">
  <strong>Not being collected yet.</strong>
  <p style="margin:.4rem 0 0;font-size:.9rem">${escapeHtml(view.capacityNote)}</p>
</div>`;

  return layout(
    `#${view.display} activity`,
    `<h1>#${escapeHtml(view.display)}</h1>
<p class="statement">${escapeHtml(view.statement)}</p>
${notTracked}

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
      <dd>${
        view.tracked
          ? `${view.pollIntervalSeconds < 60 ? `${view.pollIntervalSeconds} seconds` : `${view.pollIntervalSeconds / 60} minutes`} (${escapeHtml(view.tier)} tier)`
          : '<span class="unavailable">not polled, index at capacity</span>'
      }</dd>
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

<h2 id="how-tags-are-chosen">How tags are chosen</h2>
<p>This index polls a limited number of hashtags, because every tracked tag costs
requests and database writes and the budget is fixed. So tags have to earn a slot,
and some have to lose one.</p>
<p>Most tags arrive by being noticed rather than by being asked for. A post
collected for one hashtag usually carries others, and those become candidates. It
costs nothing to see them, because the request has already been made.</p>

<h3>Three tests, and why it took three tries</h3>
<p>A candidate needs <strong>at least 5 distinct authors</strong>, <strong>at least
3 distinct origin servers</strong>, and <strong>no more than 5 authors per
server</strong> before it is polled.</p>
<p>The author count is the obvious test. It stops a single enthusiastic account
earning a slot by posting the same tag two hundred times, and counting distinct
people rather than uses is what makes that impossible rather than merely
unlikely.</p>
<p>It is not enough on its own, and the reason is worth explaining because it took
two failed attempts to get right. An automated news feed running fifteen accounts
on two servers has fifteen genuinely distinct authors. By author count it is
indistinguishable from a conversation.</p>
<p>The first attempt required a minimum number of origin servers. That worked on
the sample it was built from, where the feeds sat at 2 to 3 servers and genuine tags
at 31 to 69. Twelve hours later the feeds had reached 4 to 7 servers and were
passing the test. Breadth grows the longer you watch, so a threshold set from a
snapshot ends up in the wrong place.</p>
<p>The second attempt was posts per author, which looked independent of scale and
was not. It would have retired <code>#news</code>, one of the most active genuine
tags in the index, because a busy tag accumulates posts against a stable pool of
authors and its ratio climbs just as a feed's does.</p>
<p>What holds still is <strong>authors per server</strong>:</p>
<div class="scroll"><table>
<thead><tr><th>Tag</th><th class="num">Authors</th><th class="num">Servers</th><th class="num">Authors per server</th></tr></thead>
<tbody>
<tr><td>an automated feed</td><td class="num">67</td><td class="num">4</td><td class="num">16.8</td></tr>
<tr><td>another</td><td class="num">33</td><td class="num">4</td><td class="num">8.3</td></tr>
<tr><td>#news</td><td class="num">384</td><td class="num">99</td><td class="num">3.9</td></tr>
<tr><td>#photography</td><td class="num">161</td><td class="num">65</td><td class="num">2.5</td></tr>
<tr><td>#buddhism</td><td class="num">7</td><td class="num">3</td><td class="num">2.3</td></tr>
</tbody></table></div>
<p>A publisher adds accounts without adding servers. A conversation spreads across
servers as it gains people, so both numbers grow together and the ratio stays flat
however large the tag gets. Measured at two points twelve hours apart, the feeds sat
at 7 to 30 and the genuine tags at 2.3 to 3.9, and neither cluster moved.</p>

<h3>What these tests cost</h3>
<p>The server floor is deliberately low, at three, because it is no longer doing the
work of spotting publishers. It only excludes hashtags confined to one or two
servers. Those are a single server's local timeline rather than activity across the
network, and this index would see them at all only if it happened to monitor that
server.</p>
<p>Keeping it low matters. An earlier, higher floor would have excluded
<code>#buddhism</code>, a real community of seven people across three servers. Small
communities are exactly what an index like this should surface, so a test that
mistakes small for fake is a bad test.</p>

<h3>Losing a slot</h3>
<p>A tag stops being polled when it has produced nothing for a day and nobody has
asked about it for a week, or when it turns out to be a publisher rather than a
community on the figures above. Both thresholds are applied to tags already being
polled, not only to new ones, so a tag admitted before a rule existed is judged by
it too.</p>
<p>A hashtag somebody has asked about recently is never dropped. Someone watching a
quiet tag is a perfectly good reason to keep watching it.</p>

<h3>Asking for a tag</h3>
<p>Searching for a hashtag counts as asking for it, and a request goes ahead of
anything found automatically, because you are waiting on the answer and a noticed
tag is not. If the index is at capacity your request is recorded and takes the next
free slot. The page will say plainly that the tag is not being collected yet rather
than showing you windows and letting you assume it is.</p>

<h3>One signal recorded but not acted on</h3>
<p>The average number of hashtags on the posts carrying a tag is measured and shown
on the <a href="/tags">all tags</a> page. A post with fifteen hashtags is a
broadcast and a person tagging usually manages three. It is published rather than
enforced, because nothing has yet slipped through that it would have caught, and
guessing at thresholds without evidence is precisely what the two failed attempts
above did wrong.</p>

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

// --- All tags, the discovery page -------------------------------------------

export interface TagsView {
  statement: string;
  asOf: string;
  order: 'authors' | 'posts' | 'name';
  rankingNote: string;
  trackedNote: string;
  discoveredNote: string;
  tracked: {
    tag: string;
    display: string;
    tier: string;
    postsObserved: number;
    authorsObserved: number;
    postsPerAuthor: number | null;
    posts1h: number;
    authors1h: number;
    originServers: number;
  }[];
  discovered: {
    tag: string;
    authorsObserved: number;
    originServers: number;
    meanTagsPerPost: number | null;
    wouldPromote: boolean;
    looksLikeTagSpam: boolean;
  }[];
  promotionRule: { minAuthors: number; minOriginServers: number; why: string };
}

/**
 * A bar showing a value against the largest in the column.
 *
 * Inline and unitless on purpose. The number beside it is the fact; this is only
 * there so the shape of the distribution is visible without reading every row.
 */
function bar(value: number, peak: number): string {
  const share = peak <= 0 ? 0 : Math.max(0, Math.min(1, value / peak));
  const width = Math.round(share * 100);
  return `<span style="display:inline-block;width:3.5rem;height:.4rem;background:var(--line);
    border-radius:.2rem;overflow:hidden;vertical-align:middle">
    <span style="display:block;width:${width}%;height:100%;background:var(--accent)"></span></span>`;
}

export function tagsPage(view: TagsView): string {
  const peakAuthors = Math.max(1, ...view.tracked.map((tag) => tag.authorsObserved));
  const peakDiscovered = Math.max(1, ...view.discovered.map((tag) => tag.authorsObserved));

  const orderLink = (key: TagsView['order'], label: string): string =>
    view.order === key
      ? `<strong>${escapeHtml(label)}</strong>`
      : `<a href="/tags?order=${key}">${escapeHtml(label)}</a>`;

  const trackedRows = view.tracked
    .map(
      (tag) => `<tr>
  <td><a href="/tag/${encodeURIComponent(tag.tag)}">#${escapeHtml(tag.display)}</a></td>
  <td class="num">${formatCount(tag.authorsObserved)} ${bar(tag.authorsObserved, peakAuthors)}</td>
  <td class="num">${formatCount(tag.postsObserved)}</td>
  <td class="num">${
    tag.postsPerAuthor === null
      ? '<span class="unavailable">&mdash;</span>'
      : `<span class="${tag.postsPerAuthor >= 5 ? 'q-partial' : ''}">${tag.postsPerAuthor}</span>`
  }</td>
  <td class="num">${formatCount(tag.authors1h)}</td>
  <td class="num">${formatCount(tag.originServers)}</td>
  <td>${escapeHtml(tag.tier)}</td>
</tr>`,
    )
    .join('\n');

  const discoveredRows = view.discovered
    .map(
      (tag) => `<tr>
  <td><a href="/tag/${encodeURIComponent(tag.tag)}">#${escapeHtml(tag.tag)}</a></td>
  <td class="num">${formatCount(tag.authorsObserved)} ${bar(tag.authorsObserved, peakDiscovered)}</td>
  <td class="num ${tag.originServers < view.promotionRule.minOriginServers ? 'q-thin' : ''}">${formatCount(tag.originServers)}</td>
  <td class="num">${
    tag.meanTagsPerPost === null
      ? '<span class="unavailable">&mdash;</span>'
      : `<span class="${tag.looksLikeTagSpam ? 'q-partial' : ''}">${tag.meanTagsPerPost}</span>`
  }</td>
  <td>${
    tag.wouldPromote
      ? '<span class="q-good">queued</span>'
      : tag.originServers < view.promotionRule.minOriginServers
        ? '<span class="q-thin">too few servers</span>'
        : '<span class="unavailable">too few authors</span>'
  }</td>
</tr>`,
    )
    .join('\n');

  return layout(
    'All tags',
    `<h1>All tags</h1>
<p class="statement">${escapeHtml(view.statement)}</p>
<p class="note">${escapeHtml(view.rankingNote)}</p>
<p class="note">Order by ${orderLink('authors', 'authors')} &middot;
  ${orderLink('posts', 'posts')} &middot; ${orderLink('name', 'name')}</p>

<h2>Tracked (${view.tracked.length})</h2>
<p class="note">${escapeHtml(view.trackedNote)}</p>
${
  view.tracked.length === 0
    ? '<p class="note">Nothing tracked yet.</p>'
    : `<div class="scroll"><table>
<thead><tr>
  <th>Tag</th>
  <th class="num">Authors 24h</th>
  <th class="num">Posts 24h</th>
  <th class="num">Posts per author</th>
  <th class="num">Authors 1h</th>
  <th class="num">Servers</th>
  <th>Tier</th>
</tr></thead>
<tbody>${trackedRows}</tbody></table></div>
<p class="note">Posts per author is highlighted above 5, where a tag is likely a
few accounts posting a lot rather than a conversation.</p>`
}

<h2>Discovered (${view.discovered.length})</h2>
<p class="note">${escapeHtml(view.discoveredNote)}</p>
${
  view.discovered.length === 0
    ? `<p class="note">Nothing discovered yet. Candidates appear once the collector
       has seen a tag used by several different people on posts it collected.</p>`
    : `<div class="scroll"><table>
<thead><tr>
  <th>Tag</th><th class="num">Authors 48h</th><th class="num">Servers</th>
  <th class="num">Tags per post</th><th>Status</th>
</tr></thead>
<tbody>${discoveredRows}</tbody></table></div>
<p class="note">A tag needs ${view.promotionRule.minAuthors} distinct authors
<em>and</em> ${view.promotionRule.minOriginServers} distinct origin servers before it
is polled. ${escapeHtml(view.promotionRule.why)}
<a href="/coverage#how-tags-are-chosen">More on how tags are chosen</a>.</p>`
}
<p class="note">As of ${escapeHtml(view.asOf.slice(0, 19).replace('T', ' '))} UTC.
Same data as <code>/api/v1/tags</code>.</p>`,
    view.statement,
  );
}

// --- Explore, the two charts ----------------------------------------------------

export interface ExploreView {
  statement: string;
  asOf: string;
  tags: ExploreTag[];
}

function tierName(tier: string): string {
  return tier === 'hot' ? 'Hot' : tier === 'warm' ? 'Warm' : 'Cold';
}

function scatterSvg(tags: readonly ExploreTag[]): string {
  const frame = DEFAULT_FRAME;
  const points = scatterPoints(tags, frame);
  if (points.length === 0) {
    return '<p class="note">No tag has had an author in the last 24 hours, so there is nothing to place.</p>';
  }

  const left = frame.pad.left;
  const right = frame.width - frame.pad.right;
  const top = frame.pad.top;
  const bottom = frame.height - frame.pad.bottom;
  const maxAuthors = Math.max(...points.map((point) => point.tag.authors24h));
  const maxRatio = Math.max(SHOUTING_THRESHOLD * 2, ...points.map((point) => point.postsPerAuthor));

  const xTicks = logTicks(maxAuthors)
    .map((value) => {
      const x = Math.round(logScale(value, 1, maxAuthors, left, right) * 10) / 10;
      return `<line class="axis" x1="${x}" x2="${x}" y1="${bottom}" y2="${bottom + 4}"/>
<text class="axis-label" x="${x}" y="${bottom + 16}" text-anchor="middle">${value}</text>`;
    })
    .join('\n');
  const yTicks = logTicks(maxRatio)
    .map((value) => {
      const y = Math.round(logScale(value, 1, maxRatio, bottom, top) * 10) / 10;
      return `<line class="axis" x1="${left - 4}" x2="${left}" y1="${y}" y2="${y}"/>
<text class="axis-label" x="${left - 8}" y="${y + 4}" text-anchor="end">${value}</text>`;
    })
    .join('\n');

  const lineY = thresholdY(tags, frame);
  const threshold =
    lineY === null
      ? ''
      : `<line class="threshold" x1="${left}" x2="${right}" y1="${lineY}" y2="${lineY}"/>
<text class="threshold-label" x="${right}" y="${lineY - 5}" text-anchor="end">${SHOUTING_THRESHOLD} posts per author</text>`;

  const dots = points
    .map(
      (point) => `<g class="dot tier-${escapeHtml(point.tag.tier)}" data-tag="${escapeHtml(point.tag.name)}">
  <title>#${escapeHtml(point.tag.display)}: ${formatCount(point.tag.authors24h)} authors, ${formatCount(
    point.tag.posts24h,
  )} posts (${point.postsPerAuthor} per author), ${formatCount(point.tag.originServers)} servers, ${tierName(
    point.tag.tier,
  ).toLowerCase()}</title>
  <circle cx="${point.x}" cy="${point.y}" r="${point.r}"/>
  <text x="${point.x + point.r + 3}" y="${point.y + 4}">#${escapeHtml(point.tag.display)}</text>
</g>`,
    )
    .join('\n');

  return `<svg viewBox="0 0 ${frame.width} ${frame.height}" role="img"
  aria-label="Tracked tags placed by distinct authors against posts per author">
<line class="axis" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/>
<line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"/>
${xTicks}
${yTicks}
<text class="axis-label" x="${(left + right) / 2}" y="${frame.height - 6}" text-anchor="middle">Distinct authors, 24h (log)</text>
<text class="axis-label" transform="translate(12 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle">Posts per author (log)</text>
${threshold}
${dots}
</svg>`;
}

function rhythmStrip(tags: readonly ExploreTag[]): string {
  if (tags.length === 0) return '<p class="note">Nothing tracked yet.</p>';
  const width = 240;
  const height = 28;
  const rows = stripOrder(tags)
    .map((tag) => {
      const peak = Math.max(...tag.hourly);
      return `<div class="row row-${escapeHtml(tag.tier)}" data-tag="${escapeHtml(tag.name)}" style="display:contents">
  <div class="tag"><a href="/tag/${encodeURIComponent(tag.name)}">#${escapeHtml(tag.display)}</a><small>${escapeHtml(
    tag.tier,
  )}</small></div>
  <div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
    aria-label="Posts per hour for #${escapeHtml(tag.display)}, peak ${peak}"><polyline points="${rhythmPath(
      tag.hourly,
      width,
      height,
    )}"/></svg></div>
  <div class="peak">${peak === 0 ? '<span class="unavailable">quiet</span>' : `${formatCount(peak)}/h`}</div>
</div>`;
    })
    .join('\n');

  return `<div class="strip">
${rows}
<div class="hours"><span>24h ago</span><span>12h ago</span><span>now</span></div>
</div>`;
}

/**
 * The only scripting in the interface, and the page works without it. Hovering
 * or clicking a dot highlights the same tag in the strip and vice versa, so the
 * two charts read as one.
 */
const EXPLORE_SCRIPT = `
(function () {
  var items = document.querySelectorAll('[data-tag]');
  var pinned = null;
  function apply(name) {
    items.forEach(function (el) {
      var match = name !== null && el.getAttribute('data-tag') === name;
      el.classList.toggle('active', match);
      el.classList.toggle('dim', name !== null && !match);
    });
  }
  items.forEach(function (el) {
    var name = el.getAttribute('data-tag');
    el.addEventListener('mouseenter', function () { if (pinned === null) apply(name); });
    el.addEventListener('mouseleave', function () { if (pinned === null) apply(null); });
    el.addEventListener('click', function (event) {
      if (event.target.closest('a')) return;
      pinned = pinned === name ? null : name;
      apply(pinned);
    });
  });
})();
`;

export function explorePage(view: ExploreView): string {
  return layout(
    'Explore',
    `<h1>Explore</h1>
<p class="statement">${escapeHtml(view.statement)}</p>
<p class="note">Two views of the tracked set. The first asks whether a tag is a conversation or
one person repeating themselves; the second shows the shape of each tag's day. Hover or click a
tag in either to pick it out in both.</p>

<h2>Conversation or megaphone</h2>
<p class="note">Right is many people; up is few people posting a lot. The dashed line is where
posts per author passes ${SHOUTING_THRESHOLD}, above which a count is more likely a handful of
accounts than a conversation. Dot size is how many different servers the posts came from.</p>
<div class="chart">${scatterSvg(view.tags)}
<p class="legend"><span class="hot">Hot tier</span><span>Warm tier</span><span class="cold">Cold tier</span></p>
</div>

<h2>The shape of the day</h2>
<p class="note">Posts per hour over the last 24 hours, each tag scaled to its own peak so a
quiet tag's rhythm is as visible as a busy one's. The figure at the right is that peak. Grouped
by polling tier, busiest first.</p>
<div class="chart">${rhythmStrip(view.tags)}</div>

<p class="note">As of ${escapeHtml(view.asOf.slice(0, 19).replace('T', ' '))} UTC. Author and
post counts exclude boosts. Same data as <code>/api/v1/tags</code> and each tag's
<code>/timeseries</code>.</p>
<script>${EXPLORE_SCRIPT}</script>`,
    view.statement,
  );
}
