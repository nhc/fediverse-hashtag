/**
 * WebMCP: tools a browser-resident agent can call on this site.
 *
 * Served inline from the shared layout and feature-detected, so a browser
 * without navigator.modelContext runs nothing. Each tool's execute is a fetch to
 * our own JSON API. No judgement lives here that is not already in src/api.ts
 * or src/aggregate.ts, where it is tested. Design and reasoning: docs/webmcp/.
 */

export const WEBMCP_SCRIPT = `
(function () {
  if (typeof navigator === 'undefined' || !navigator.modelContext ||
      typeof navigator.modelContext.registerTool !== 'function') return;

  function asText(value) {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }

  navigator.modelContext.registerTool({
    name: 'evaluate_hashtags',
    description:
      'Check hashtags a person is thinking of using against what this index has ' +
      'observed on the Mastodon-compatible servers it monitors. You supply the ' +
      'candidates (read the draft and propose them yourself; the index stores no ' +
      'post content and cannot judge fit). For each one it returns how many ' +
      'distinct accounts used it in 24 hours, how many servers it reaches, and ' +
      'authors_per_server, which is how you tell a conversation from a publisher: ' +
      'above about 5 the accounts are concentrated in one place. posts_per_author ' +
      'is also given but is context only, because a busy genuine tag climbs on it ' +
      'too. standing is tracked, discovered or unseen; read ' +
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
      var list = Array.isArray(args && args.candidates) ? args.candidates : [];
      var url = '/api/v1/evaluate?tags=' + encodeURIComponent(list.join(','));
      var res = await fetch(url, { headers: { 'x-webmcp-tool': 'evaluate_hashtags' } });
      return asText(await res.json());
    }
  });
})();
`;
