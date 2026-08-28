/**
 * WebMCP: tools a browser-resident agent can call on this site.
 *
 * Served inline from the shared layout and feature-detected, so a browser
 * without a model context runs nothing. Each tool's execute is a fetch to our
 * own JSON API. No judgement lives here that is not already in src/api.ts or
 * src/aggregate.ts, where it is tested. Design and reasoning: docs/webmcp/.
 *
 * The native API is navigator.modelContext, and that is what we use wherever
 * it exists. ChatGPT's in-app browser has no native API and instead injects a
 * plain object at document.modelContext; the challenge's sample code uses the
 * same name. That object is used only when the native one is absent, never as
 * well as it. Some hosts may attach either after the page has loaded, so the
 * check runs again at DOMContentLoaded and load. Registration happens once.
 */

export const WEBMCP_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;
  var registered = false;

  // Native first. The injected document object only when there is no native API.
  function host() {
    try { if (navigator.modelContext) return navigator.modelContext; } catch (e) {}
    try { if (document.modelContext) return document.modelContext; } catch (e) {}
    return null;
  }

  function asText(value) {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }

  var evaluateHashtags = {
    name: 'evaluate_hashtags',
    description:
      'Evaluate hashtags a person is thinking of using for a post, against what ' +
      'this index has observed on the Mastodon-compatible servers it monitors. ' +
      'Use this for "which hashtags should I use" questions. If the person asks ' +
      'to COMPARE tags, use compare_hashtags instead: it shows the comparison on ' +
      'the page as well. You supply the ' +
      'candidates (read the draft and propose them yourself; the index stores no ' +
      'post content and cannot judge fit). For each one it returns how many ' +
      'distinct accounts used it in 24 hours, how many servers it reaches, and ' +
      'posts_per_author, so you can tell a conversation from a few accounts ' +
      'posting a lot. standing is tracked, discovered or unseen; read ' +
      'standing_note before quoting a figure, and treat unseen as no evidence, ' +
      'not as unused. Registers nothing and has no side effects. Up to 10 tags.',
    inputSchema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 10,
          description: 'Hashtags to evaluate, with or without the leading #.'
        }
      },
      required: ['candidates']
    },
    async execute(args) {
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      var list = Array.isArray(args && args.candidates) ? args.candidates : [];
      var url = '/api/v1/evaluate?tags=' + encodeURIComponent(list.join(','));
      var res = await fetch(url, { headers: { 'x-webmcp-tool': 'evaluate_hashtags' } });
      return asText(await res.json());
    }
  };

  var trendingHashtags = {
    name: 'trending_hashtags',
    description:
      'Which hashtags are busiest right now among the ones this index is ' +
      'tracking, ranked by distinct authors in the last hour. Each entry has a ' +
      'trend direction against the previous hour that can be not_comparable ' +
      '(coverage shifted, so do not call it up or down) or insufficient (too few ' +
      'authors), plus two recent public posts as evidence. Read scope first: this ' +
      'is a ranking within about 50 tracked tags on a handful of monitored ' +
      'servers, not a fediverse-wide trending list. Read-only, no side effects.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5,
                 description: 'How many tags to return.' }
      }
    },
    async execute(args) {
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      var limit = args && args.limit ? Number(args.limit) : 5;
      var res = await fetch('/api/v1/trending?limit=' + encodeURIComponent(String(limit)),
        { headers: { 'x-webmcp-tool': 'trending_hashtags' } });
      return asText(await res.json());
    }
  };

  // Renders into the page as well as returning data, so the person and the
  // agent look at the same table. Figures come from /api/v1/evaluate (nothing
  // registered) and the sparklines from /timeseries (read-only). No server code.
  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hourlyBars(points) {
    var buckets = new Array(24).fill(0);
    if (!points || !points.length) return buckets;
    var last = Date.parse(points[points.length - 1].at);
    points.forEach(function (p) {
      var ageH = Math.floor((last - Date.parse(p.at)) / 3600000);
      if (ageH >= 0 && ageH < 24) buckets[23 - ageH] += p.posts_observed;
    });
    return buckets;
  }
  function sparkline(bars) {
    var max = Math.max.apply(null, bars.concat([1]));
    var w = 120, h = 28, bw = w / bars.length;
    var rects = bars.map(function (v, i) {
      var bh = Math.max(1, Math.round((v / max) * (h - 2)));
      return '<rect x="' + (i * bw).toFixed(1) + '" y="' + (h - bh) + '" width="' + (bw - 1).toFixed(1) + '" height="' + bh + '" fill="currentColor" opacity="' + (i === bars.length - 1 ? 1 : 0.55) + '"/>';
    }).join('');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="posts per hour, last 24 hours">' + rects + '</svg>';
  }
  function fmt(v) { return v === null || v === undefined ? '—' : String(v); }

  function renderComparison(data, series) {
    var main = document.querySelector('main') || document.body;
    var old = document.getElementById('webmcp-compare');
    if (old) old.remove();
    var rows = data.candidates.map(function (c) {
      var bars = series[c.tag] ? hourlyBars(series[c.tag].points) : null;
      var sr = c.server_reported;
      return '<tr>' +
        '<td><a href="/tag/' + encodeURIComponent(c.tag) + '">#' + esc(c.display) + '</a></td>' +
        '<td>' + esc(c.standing) + '</td>' +
        '<td>' + fmt(c.authors_24h) + (sr ? '<br><span class="note">' + esc(sr.accounts_7d) + ' server-reported, 7 days</span>' : '') + '</td>' +
        '<td>' + fmt(c.posts_24h) + '</td>' +
        '<td>' + fmt(c.origin_servers_24h) + '</td>' +
        '<td>' + fmt(c.posts_per_author) + '</td>' +
        '<td>' + fmt(c.authors_1h) + '</td>' +
        '<td>' + (bars ? sparkline(bars) : '<span class="note">not polled</span>') + '</td>' +
        '</tr>';
    }).join('');
    var section = document.createElement('section');
    section.id = 'webmcp-compare';
    section.className = 'webmcp-compare';
    section.innerHTML =
      '<h2>Comparison, placed here by your agent <button type="button" class="webmcp-dismiss" aria-label="Remove comparison">Remove</button></h2>' +
      '<p class="note">' + esc(data.statement) + ' As of ' + esc(data.as_of) + '. ' +
      esc(data.provenance.instances_monitored) + ' servers monitored, ' + esc(data.provenance.instances_healthy) + ' healthy. Nothing was registered by this comparison.</p>' +
      '<div class="scroll"><table><thead><tr><th>Tag</th><th>Standing</th><th>Accounts, 24h</th><th>Posts, 24h</th><th>Servers</th><th>Posts / author</th><th>Accounts, last hour</th><th>Posts per hour, 24h</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">' + esc(data.note) + '</p>';
    section.querySelector('.webmcp-dismiss').addEventListener('click', function () {
      section.remove();
      try { sessionStorage.removeItem('webmcp-compare'); } catch (e) {}
    });
    main.insertBefore(section, main.firstChild);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // The agent may navigate after calling. Keep the comparison for the next
    // page in this tab, once, so what it told the person is on the page is.
    try { sessionStorage.setItem('webmcp-compare', JSON.stringify({ data: data, series: series, at: Date.now() })); } catch (e) {}
  }

  function restoreComparison() {
    try {
      var raw = sessionStorage.getItem('webmcp-compare');
      if (!raw) return;
      var saved = JSON.parse(raw);
      // Ten minutes, and never on the page that drew it (it is already there).
      if (Date.now() - saved.at > 600000 || document.getElementById('webmcp-compare')) return;
      renderComparison(saved.data, saved.series);
    } catch (e) {}
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', restoreComparison);
  else restoreComparison();

  var compareHashtags = {
    name: 'compare_hashtags',
    description:
      'COMPARE two to four hashtags. Use this whenever the person says compare, ' +
      'versus, side by side, or asks which of several tags is busier. It renders ' +
      'a comparison table into the page the person is looking at, so you both ' +
      'see the same thing (evaluate_hashtags does not do this): ' +
      'accounts and posts over 24 hours, server reach, posts per author, the last ' +
      'hour, and a posts-per-hour sparkline for tags this index polls. Uses the ' +
      'same evidence as evaluate_hashtags, including standing (tracked, ' +
      'discovered, unseen) and server-reported counters for unseen tags; a fair ' +
      'comparison needs the tags to have similar standing, and the result says ' +
      'when they do not. Registers nothing. After calling, tell the person the ' +
      'comparison is on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4,
                description: 'Hashtags to compare, with or without the leading #.' }
      },
      required: ['tags']
    },
    async execute(args) {
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      var list = Array.isArray(args && args.tags) ? args.tags.slice(0, 4) : [];
      var res = await fetch('/api/v1/evaluate?tags=' + encodeURIComponent(list.join(',')),
        { headers: { 'x-webmcp-tool': 'compare_hashtags' } });
      var data = await res.json();
      if (!data.candidates) return asText(data);
      var series = {};
      await Promise.all(data.candidates.filter(function (c) { return c.standing === 'tracked'; }).map(async function (c) {
        try {
          var r = await fetch('/api/v1/tags/' + encodeURIComponent(c.tag) + '/timeseries');
          if (r.ok) series[c.tag] = await r.json();
        } catch (e) {}
      }));
      var standings = {};
      data.candidates.forEach(function (c) { standings[c.standing] = true; });
      var mixed = Object.keys(standings).length > 1;
      try { renderComparison(data, series); } catch (e) {}
      return asText({
        rendered_in_page: true,
        anchor: '#webmcp-compare',
        comparable: !mixed,
        comparability_note: mixed
          ? 'The tags have different standings with this index, so their figures come from different kinds of evidence and are not directly comparable. Say so.'
          : 'All tags have the same standing, so the figures are like for like.',
        as_of: data.as_of,
        statement: data.statement,
        side_effects: data.side_effects,
        candidates: data.candidates,
        provenance: data.provenance
      });
    }
  };

  // The one tool with a side effect, said in its description and in its result.
  // A lookup is a search: it registers the tag as requested and can start
  // collection if there is room under the ceiling. The page moves to the tag
  // afterwards, a beat after the result is returned so the host has it.
  function windowFigures(w) {
    if (!w) return null;
    var direction = !w.coverage_comparable ? 'not_comparable'
      : w.trend === null ? 'insufficient'
      : w.trend > 0.1 ? 'up' : w.trend < -0.1 ? 'down' : 'flat';
    return {
      posts_observed: w.posts_observed,
      authors_observed: w.authors_observed,
      posts_per_author: w.authors_observed > 0 ? Math.round((w.posts_observed / w.authors_observed) * 10) / 10 : null,
      instances_reporting: w.instances_reporting,
      trend: {
        direction: direction,
        change: w.trend === null ? null : Math.round(w.trend * 100) / 100,
        comparable: !!w.coverage_comparable,
        reason: !w.coverage_comparable
          ? 'This window and the one before it were reported by different shares of the monitored servers, so a change in the count could be a change in coverage.'
          : w.trend === null ? 'Nothing in the previous window to compare against.' : null
      }
    };
  }

  var lookupHashtag = {
    name: 'lookup_hashtag',
    description:
      'Look up ONE hashtag in depth: posts and distinct accounts over 5 minutes, ' +
      '1 hour and 24 hours, trend with a comparability flag, which servers ' +
      'contributed, coverage quality (good, partial, thin) and freshness. Read ' +
      'status first: insufficient_data means no reliable figure exists yet and ' +
      'reason says why. Every figure is what this index can see from the servers ' +
      'it monitors, not a fediverse count. SIDE EFFECT: a lookup is a search. It ' +
      'registers the tag as requested and may start collecting it. For several ' +
      'tags, or to check candidates for a post, use evaluate_hashtags, which ' +
      'registers nothing. Moves the page to the tag afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', minLength: 1, maxLength: 100,
               description: 'The hashtag, with or without the leading #.' },
        window: { type: 'string', enum: ['5m', '1h', '24h'], default: '24h',
                  description: 'Which window to headline. All are returned.' }
      },
      required: ['tag']
    },
    async execute(args) {
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      var raw = String((args && args.tag) || '').trim().replace(/^#/, '');
      var windowKey = (args && args.window) || '24h';
      if (!raw) return asText({ status: 'invalid_tag', reason: 'No hashtag given.' });
      var res = await fetch('/api/v1/tags/' + encodeURIComponent(raw), { headers: { 'x-webmcp-tool': 'lookup_hashtag' } });
      var d = await res.json();
      if (!res.ok || !d.tag) return asText({ status: 'invalid_tag', reason: d.error || 'Not a usable hashtag.' });

      var w24 = d.windows && d.windows['24h'];
      var observed = w24 ? w24.posts_observed : 0;
      var history = d.instance_daily_counters;
      var result = {
        status: observed > 0 ? 'ok' : 'insufficient_data',
        tag: d.tag,
        display: d.display,
        as_of: d.as_of,
        statement: d.statement,
        provenance: {
          instances_monitored: d.coverage.instances_monitored,
          instances_healthy: d.coverage.instances_monitored - (d.coverage.instances_degraded || []).length,
          instances_reporting_24h: d.coverage.instances_reporting,
          reported_by: d.coverage.reported_by,
          last_successful_update: d.coverage.last_successful_update,
          coverage: d.coverage.quality,
          median_instances_seeing_a_post: d.coverage.median_instances_per_post,
          origin_servers_24h: d.coverage.unique_origin_servers,
          poll_interval_seconds: d.tracking.poll_interval_seconds,
          completeness: 'partial'
        },
        side_effects: {
          query_registered: true,
          tracked: d.tracking.tracked,
          newly_tracked: !!(d.tracking.newly_registered && d.tracking.tracked),
          capacity_note: d.tracking.capacity_note
        },
        page: { navigating_to: '/tag/' + encodeURIComponent(d.tag) }
      };
      if (result.status === 'ok') {
        result.headline = windowFigures(d.windows[windowKey] || w24);
        result.headline_window = d.windows[windowKey] ? windowKey : '24h';
        result.windows = { '5m': windowFigures(d.windows['5m']), '1h': windowFigures(d.windows['1h']), '24h': windowFigures(w24) };
        result.top_origin_servers = (d.origins || []).slice(0, 5);
      } else {
        result.reason = d.tracking.tracked
          ? (d.tracking.newly_registered
              ? 'This index was not watching the tag until this lookup registered it. Collection starts on the next tick; nothing has been observed yet.'
              : 'Tracked, but nothing observed in the last 24 hours.')
          : 'Not being collected: the tracked set is at its ceiling. Recorded as requested.';
        result.what_would_change_it = d.tracking.tracked
          ? 'Ask again after the next collection tick (a few minutes).'
          : 'A slot freeing up in the tracked set; this tag is at the front of the queue.';
      }
      if (history && history.days && history.days.length) {
        result.server_reported_history = {
          note: history.note + ' Server-reported, not observed; do not merge with the figures above.',
          source_servers: Array.from(new Set(history.days.map(function (x) { return x.host; }))),
          days: history.days
        };
      }
      setTimeout(function () { try { location.assign('/tag/' + encodeURIComponent(d.tag)); } catch (e) {} }, 400);
      return asText(result);
    }
  };

  var describeCoverage = {
    name: 'describe_coverage',
    description:
      'What this index can and cannot see: which servers it monitors and their ' +
      'capability, how tags are chosen, known limitations, and the opt-out route. ' +
      'Call this before making claims about "the fediverse" from any figure here, ' +
      'and when a person asks how much of the network the site covers or how the ' +
      'numbers are produced. Read-only, no side effects.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      var res = await fetch('/api/v1/coverage', { headers: { 'x-webmcp-tool': 'describe_coverage' } });
      var d = await res.json();
      d.side_effects = { queries_registered: 0 };
      d.how_to_phrase_it = 'Say "observed by this index across N monitored servers", never "across the fediverse". No server can see the whole network, so no complete count exists.';
      return asText(d);
    }
  };

  var tools = [evaluateHashtags, trendingHashtags, compareHashtags, lookupHashtag, describeCoverage];

  function register() {
    if (registered) return;
    var h = host();
    if (!h || typeof h.registerTool !== 'function') return;
    try { tools.forEach(function (t) { h.registerTool(t); }); registered = true; } catch (e) {}
  }

  register();
  window.addEventListener('DOMContentLoaded', register);
  window.addEventListener('load', register);
  window.__webmcpRegistered = function () { return registered ? tools.length : 0; };
})();
`;

/**
 * A plain-text report of what this browser exposes, for testing inside agent
 * browsers that have no developer tools. Fills in after load.
 */
export const WEBMCP_DIAGNOSTIC_SCRIPT = `
(async function () {
  var el = document.getElementById('webmcp-report');
  if (!el) return;
  var lines = [];
  var nav = null, doc = null;
  try { nav = navigator.modelContext || null; } catch (e) {}
  try { doc = document.modelContext || null; } catch (e) {}
  lines.push('navigator.modelContext: ' + (nav ? 'present' : 'absent'));
  lines.push('document.modelContext: ' + (doc ? 'present' : 'absent') + (nav && doc ? (nav === doc ? ' (same object)' : ' (different object)') : ''));
  var host = nav || doc;
  if (host) {
    lines.push('using: ' + (nav ? 'navigator.modelContext (native)' : 'document.modelContext (injected by the host; no native API here)'));
    var names = [];
    try { var p = Object.getPrototypeOf(host); names = Object.getOwnPropertyNames(p).filter(function (n) { return n !== 'constructor'; }); } catch (e) {}
    lines.push('methods: ' + (names.join(', ') || 'unknown'));
    try {
      if (typeof host.getTools === 'function') {
        var tools = await host.getTools();
        lines.push('tools registered: ' + tools.length + (tools.length ? ' (' + tools.map(function (t) { return t.name; }).join(', ') + ')' : ''));
      } else {
        lines.push('tools registered: getTools not available; our script registered on ' + (window.__webmcpRegistered ? window.__webmcpRegistered() : '?') + ' object(s)');
      }
    } catch (e) { lines.push('getTools failed: ' + e); }
  } else {
    lines.push('No model context in this browser. WebMCP is off or unsupported here.');
  }
  lines.push('secure context: ' + window.isSecureContext);
  lines.push('user agent: ' + navigator.userAgent);
  el.textContent = lines.join('\\n');
})();
`;
