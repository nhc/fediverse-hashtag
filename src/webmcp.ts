/**
 * WebMCP: tools a browser-resident agent can call on this site.
 *
 * Served inline from the shared layout and feature-detected, so a browser
 * without a model context runs nothing. Each tool's execute is a fetch to our
 * own JSON API. No judgement lives here that is not already in src/api.ts or
 * src/aggregate.ts, where it is tested. Design and reasoning: docs/webmcp/.
 *
 * The API is document.modelContext. Chrome 151 warns that navigator.modelContext
 * is deprecated in its favour, and ChatGPT's in-app browser provides only the
 * document form. navigator is kept as a fallback for hosts that have not
 * moved, and is never used as well as document. Some hosts may attach either
 * after the page has loaded, so the check runs again at DOMContentLoaded and
 * load. Registration happens once.
 */

export const WEBMCP_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;
  var registered = false;

  // document.modelContext is the current API; navigator is the deprecated one.
  function host() {
    try { if (document.modelContext) return document.modelContext; } catch (e) {}
    try { if (navigator.modelContext) return navigator.modelContext; } catch (e) {}
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

  // Sends the person to /compare, a page anyone can open or share, rather than
  // drawing into whatever page happens to be open. The URL is the shared state.
  var compareHashtags = {
    name: 'compare_hashtags',
    description:
      'COMPARE two to four hashtags. Use this whenever the person says compare, ' +
      'versus, side by side, or asks which of several tags is busier. It takes ' +
      'the page to /compare?tags=..., a comparison the person can see, link to ' +
      'and share, and returns the same figures to you: accounts and posts over ' +
      '24 hours, server reach, posts per author, the last hour, and standing ' +
      '(tracked, discovered, unseen) with server-reported counters for unseen ' +
      'tags. A fair comparison needs the tags to have similar standing and the ' +
      'result says when they do not. Registers nothing. After calling, tell the ' +
      'person the comparison is on the page.',
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
      var query = list.map(function (t) { return String(t).trim().replace(/^#/, ''); }).filter(Boolean).join(',');
      var res = await fetch('/api/v1/evaluate?tags=' + encodeURIComponent(query),
        { headers: { 'x-webmcp-tool': 'compare_hashtags' } });
      var data = await res.json();
      if (!data.candidates) return asText(data);
      var standings = {};
      data.candidates.forEach(function (c) { standings[c.standing] = true; });
      var mixed = Object.keys(standings).length > 1;
      var target = '/compare?tags=' + encodeURIComponent(query);
      setTimeout(function () { try { location.assign(target); } catch (e) {} }, 400);
      return asText({
        page: { navigating_to: target },
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
  var host = doc || nav;
  if (host) {
    lines.push('using: ' + (doc ? 'document.modelContext' : 'navigator.modelContext (deprecated; document.modelContext absent here)'));
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
