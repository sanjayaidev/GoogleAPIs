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

function driveClient(connection) {
  return google.drive({ version: 'v3', auth: getOAuthClient(connection) });
}

module.exports = {
  provider: 'google',
  requiredScopes: [
    'https://www.googleapis.com/auth/documents',
    // Read-only, just enough to poll modifiedTime for the documentChanged
    // trigger below - does not grant access to file contents.
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ],

  actions: {
    // Lists Google Docs files from Drive (Docs API itself has no "list"
    // endpoint - documents live in Drive, so this queries Drive filtered to
    // the Docs mimeType). Mirrors drive.js's listFiles shape.
    listDocuments: {
      inputSchema: z.object({
        query: z.string().optional(), // extra Drive query, ANDed with the mimeType filter, e.g. "name contains 'report'"
        maxResults: z.number().int().min(1).max(100).optional().default(20),
      }),
      outputSchema: z.object({ documents: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const mimeFilter = "mimeType='application/vnd.google-apps.document'";
        const q = input.query ? `${mimeFilter} and (${input.query})` : mimeFilter;
        const res = await drive.files.list({
          q,
          pageSize: input.maxResults,
          fields: 'files(id, name, mimeType, webViewLink, modifiedTime)',
        });
        return { documents: res.data.files || [] };
      },
    },

    // Resource loader for the "Select Document" dropdowns below - same data
    // as listDocuments, shaped as {value,label} options (mirrors drive.js's
    // getFiles/getFolders loaders).
    getDocuments: {
      inputSchema: z.object({
        maxResults: z.number().int().min(1).max(100).optional().default(50),
      }),
      outputSchema: z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })) }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const res = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.document'",
          pageSize: input.maxResults,
          fields: 'files(id, name)',
        });
        const options = (res.data.files || []).map(f => ({ value: f.id, label: f.name }));
        return { options };
      },
    },

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

  triggers: {
    // Polling-based: the Docs API has no "list revisions" endpoint, so this
    // just watches the file's modifiedTime via Drive metadata.
    documentChanged: {
      outputSchema: z.object({ changed: z.boolean(), modifiedTime: z.string().optional() }),
      poll: async ({ connection, input, lastCheckedAt }) => {
        const drive = driveClient(connection);
        const res = await drive.files.get({ fileId: input.documentId, fields: 'modifiedTime' });
        const modifiedTime = res.data.modifiedTime;
        const changed = modifiedTime ? new Date(modifiedTime) > new Date(lastCheckedAt) : false;
        return { changed, modifiedTime };
      },
    },
  },
};
