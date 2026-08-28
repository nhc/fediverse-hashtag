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
      'Check hashtags a person is thinking of using against what this index has ' +
      'observed on the Mastodon-compatible servers it monitors. You supply the ' +
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
      '<h2>Comparison, placed here by your agent</h2>' +
      '<p class="note">' + esc(data.statement) + ' As of ' + esc(data.as_of) + '. ' +
      esc(data.provenance.instances_monitored) + ' servers monitored, ' + esc(data.provenance.instances_healthy) + ' healthy. Nothing was registered by this comparison.</p>' +
      '<div class="scroll"><table><thead><tr><th>Tag</th><th>Standing</th><th>Accounts, 24h</th><th>Posts, 24h</th><th>Servers</th><th>Posts / author</th><th>Accounts, last hour</th><th>Posts per hour, 24h</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">' + esc(data.note) + '</p>';
    main.insertBefore(section, main.firstChild);
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  var compareHashtags = {
    name: 'compare_hashtags',
    description:
      'Compare two to four hashtags side by side and render the comparison into ' +
      'the page the person is looking at, so you both see the same table: ' +
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

  var tools = [evaluateHashtags, trendingHashtags, compareHashtags];

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
