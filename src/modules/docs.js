const { z } = require('zod');
const { google } = require('googleapis');
const env = require('../config/env');

function getOAuthClient(connection) {
  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
  client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });
  return client;
}

function docsClient(connection) {
  return google.docs({ version: 'v1', auth: getOAuthClient(connection) });
}

// Flattens a Docs API document body into plain text - the API returns a
// deeply nested structural-elements tree, most integrations just want the
// text back out.
function extractText(doc) {
  const content = doc.body?.content || [];
  let text = '';
  for (const el of content) {
    const elems = el.paragraph?.elements || [];
    for (const e of elems) {
      if (e.textRun?.content) text += e.textRun.content;
    }
  }
  return text;
}

module.exports = {
  provider: 'google',
  requiredScopes: [
    'https://www.googleapis.com/auth/documents',
  ],

  actions: {
    createDocument: {
      inputSchema: z.object({
        title: z.string(),
        body: z.string().optional(),
      }),
      outputSchema: z.object({ documentId: z.string(), url: z.string() }),
      handler: async ({ connection, input }) => {
        const docs = docsClient(connection);
        const created = await docs.documents.create({ requestBody: { title: input.title } });
        const documentId = created.data.documentId;

        if (input.body) {
          await docs.documents.batchUpdate({
            documentId,
            requestBody: {
              requests: [{ insertText: { location: { index: 1 }, text: input.body } }],
            },
          });
        }

        return { documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
      },
    },

    getDocument: {
      inputSchema: z.object({ documentId: z.string() }),
      outputSchema: z.object({ title: z.string(), text: z.string() }),
      handler: async ({ connection, input }) => {
        const docs = docsClient(connection);
        const res = await docs.documents.get({ documentId: input.documentId });
        return { title: res.data.title, text: extractText(res.data) };
      },
    },

    appendText: {
      inputSchema: z.object({
        documentId: z.string(),
        text: z.string(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const docs = docsClient(connection);
        // Insert at end of document - fetch current end index first.
        const current = await docs.documents.get({ documentId: input.documentId });
        const endIndex = (current.data.body?.content || []).reduce(
          (max, el) => (el.endIndex ? Math.max(max, el.endIndex) : max), 1
        );

        await docs.documents.batchUpdate({
          documentId: input.documentId,
          requestBody: {
            requests: [{ insertText: { location: { index: Math.max(endIndex - 1, 1) }, text: input.text } }],
          },
        });
        return { success: true };
      },
    },

    replaceAllText: {
      inputSchema: z.object({
        documentId: z.string(),
        findText: z.string(),
        replaceText: z.string(),
        matchCase: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({ occurrencesChanged: z.number().optional() }),
      handler: async ({ connection, input }) => {
        const docs = docsClient(connection);
        const res = await docs.documents.batchUpdate({
          documentId: input.documentId,
          requestBody: {
            requests: [{
              replaceAllText: {
                containsText: { text: input.findText, matchCase: input.matchCase },
                replaceText: input.replaceText,
              },
            }],
          },
        });
        const occurrencesChanged = res.data.replies?.[0]?.replaceAllText?.occurrencesChanged;
        return { occurrencesChanged };
      },
    },
  },

  triggers: {},
};
