const { z } = require('zod');

/**
 * httpRequest is the one module in the registry with no OAuth connection -
 * `noAuth: true` tells actionRouter.js and flowRunner.js to skip the
 * getConnection() lookup entirely and call the handler with
 * `connection: null`. Every other module contract (inputSchema/
 * outputSchema/handler shape) is unchanged, so it drops into the flow
 * runner, the "Run an action" tester, and the flow-builder canvas like any
 * other node.
 *
 * Headers and body are accepted as either a JSON object (from a mapped
 * `{{stepIndex.field}}` value that already resolves to an object) or a
 * JSON string (from the dashboard's textarea, parsed here) - see
 * parseMaybeJson().
 */

const headerValue = z.union([z.string(), z.number(), z.boolean()]);

function parseMaybeJson(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'object') return val; // already resolved (mapped from a prior step)
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      throw Object.assign(new Error(`Expected valid JSON, got: ${val}`), { status: 400 });
    }
  }
  return fallback;
}

module.exports = {
  provider: 'none',
  noAuth: true,
  requiredScopes: [],

  actions: {
    request: {
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('GET'),
        url: z.string().url(),
        headers: z.union([z.record(headerValue), z.string()]).optional().default({}),
        // Accept a JSON object/array directly (mapped from a prior step) or
        // a raw string (sent as-is, e.g. for non-JSON payloads).
        body: z.any().optional(),
        timeoutMs: z.number().int().min(1000).max(60000).optional().default(15000),
      }),
      outputSchema: z.object({
        statusCode: z.number(),
        headers: z.record(z.string()),
        body: z.any(),
      }),
      handler: async ({ input }) => {
        const headers = typeof input.headers === 'string' ? parseMaybeJson(input.headers, {}) : (input.headers || {});
        const method = input.method || 'GET';

        let bodyToSend;
        const hasBody = input.body !== undefined && input.body !== null && input.body !== '' && method !== 'GET';
        if (hasBody) {
          if (typeof input.body === 'string') {
            // Raw string body - forward as-is (e.g. pre-formatted JSON/XML/text).
            bodyToSend = input.body;
          } else {
            bodyToSend = JSON.stringify(input.body);
            if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
              headers['Content-Type'] = 'application/json';
            }
          }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

        try {
          const res = await fetch(input.url, {
            method,
            headers,
            body: bodyToSend,
            signal: controller.signal,
          });

          const responseHeaders = Object.fromEntries(res.headers.entries());
          const contentType = res.headers.get('content-type') || '';
          let responseBody;
          if (contentType.includes('application/json')) {
            responseBody = await res.json().catch(() => null);
          } else {
            responseBody = await res.text();
          }

          return { statusCode: res.status, headers: responseHeaders, body: responseBody };
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  },

  // No triggers - httpRequest is action-only (a "make a call" node used
  // mid-flow or as a manual test), not a poll/webhook source.
  triggers: {},
};
