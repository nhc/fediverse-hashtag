/**
 * WebMCP: tools a browser-resident agent can call on this site.
 *
 * Served inline from the shared layout and feature-detected, so a browser
 * without a model context runs nothing. Each tool's execute is a fetch to our
 * own JSON API. No judgement lives here that is not already in src/api.ts or
 * src/aggregate.ts, where it is tested. Design and reasoning: docs/webmcp/.
 *
 * Two hosts, two habits. Chrome 149 exposes the API on both navigator and
 * document; the challenge's own sample code uses document.modelContext. Some
 * hosts may attach the object after the page has loaded. So: register on every
 * distinct object found, and look again at DOMContentLoaded and load. Each
 * object is registered at most once.
 */

export const WEBMCP_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;
  var done = [];

  function hosts() {
    var out = [];
    try { if (navigator.modelContext) out.push(navigator.modelContext); } catch (e) {}
    try { if (document.modelContext && out.indexOf(document.modelContext) < 0) out.push(document.modelContext); } catch (e) {}
    return out;
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

  function register() {
    hosts().forEach(function (host) {
      if (done.indexOf(host) >= 0 || typeof host.registerTool !== 'function') return;
      try { host.registerTool(evaluateHashtags); done.push(host); } catch (e) {}
    });
  }

  register();
  window.addEventListener('DOMContentLoaded', register);
  window.addEventListener('load', register);
  window.__webmcpRegistered = function () { return done.length; };
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
