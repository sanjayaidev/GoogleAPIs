const { z } = require('zod');
const { google } = require('googleapis');
const env = require('../config/env');

/**
 * Every module follows this same shape so the core router/flow-runner
 * never needs provider-specific logic:
 *   { provider, requiredScopes, actions: { name: { inputSchema, outputSchema, handler } },
 *     triggers: { name: { outputSchema, poll } } }
 *
 * handler({ connection, input }) -> plain JS object (the action's output)
 * connection = decrypted { accessToken, refreshToken, expiresAt, ... }
 */

function getOAuthClient(connection) {
  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
  client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });
  return client;
}

function gmailClient(connection) {
  return google.gmail({ version: 'v1', auth: getOAuthClient(connection) });
}

module.exports = {
  provider: 'google',
  requiredScopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ],

  actions: {
    loadMails: {
      inputSchema: z.object({
        query: z.string().optional().default(''),
        maxResults: z.number().int().min(1).max(50).optional().default(10),
      }),
      outputSchema: z.object({ messages: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const gmail = gmailClient(connection);
        const list = await gmail.users.messages.list({
          userId: 'me',
          q: input.query,
          maxResults: input.maxResults,
        });

        const messages = await Promise.all(
          (list.data.messages || []).map(async (m) => {
            const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
            const headers = Object.fromEntries((full.data.payload.headers || []).map((h) => [h.name, h.value]));
            return { id: m.id, threadId: m.threadId, snippet: full.data.snippet, from: headers.From, subject: headers.Subject, date: headers.Date };
          })
        );

        return { messages };
      },
    },

    sendMail: {
      inputSchema: z.object({
        to: z.string().email(),
        subject: z.string(),
        body: z.string(),
      }),
      outputSchema: z.object({ messageId: z.string() }),
      handler: async ({ connection, input }) => {
        const gmail = gmailClient(connection);
        const raw = makeRawMessage({ to: input.to, subject: input.subject, body: input.body });
        const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        return { messageId: res.data.id };
      },
    },

    createDraft: {
      inputSchema: z.object({
        to: z.string().email(),
        subject: z.string(),
        body: z.string(),
      }),
      outputSchema: z.object({ draftId: z.string() }),
      handler: async ({ connection, input }) => {
        const gmail = gmailClient(connection);
        const raw = makeRawMessage({ to: input.to, subject: input.subject, body: input.body });
        const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
        return { draftId: res.data.id };
      },
    },

    reply: {
      inputSchema: z.object({
        threadId: z.string(),
        to: z.string().email(),
        subject: z.string(),
        body: z.string(),
      }),
      outputSchema: z.object({ messageId: z.string() }),
      handler: async ({ connection, input }) => {
        const gmail = gmailClient(connection);
        const raw = makeRawMessage({ to: input.to, subject: input.subject, body: input.body });
        const res = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw, threadId: input.threadId },
        });
        return { messageId: res.data.id };
      },
    },

    markAsRead: {
      inputSchema: z.object({ messageId: z.string() }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const gmail = gmailClient(connection);
        await gmail.users.messages.modify({
          userId: 'me',
          id: input.messageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
        return { success: true };
      },
    },

    addLabel: {
      inputSchema: z.object({ messageId: z.string(), labelId: z.string() }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const gmail = gmailClient(connection);
        await gmail.users.messages.modify({
          userId: 'me',
          id: input.messageId,
          requestBody: { addLabelIds: [input.labelId] },
        });
        return { success: true };
      },
    },

    // Resource loader for the "Select Label" dropdown on addLabel - both
    // Gmail's built-in labels (INBOX, UNREAD, STARRED, ...) and any custom
    // ones the account has created.
    listLabels: {
      inputSchema: z.object({}),
      outputSchema: z.object({ labels: z.array(z.any()) }),
      handler: async ({ connection }) => {
        const gmail = gmailClient(connection);
        const res = await gmail.users.labels.list({ userId: 'me' });
        return { labels: res.data.labels || [] };
      },
    },
  },

  triggers: {
    // Polling-based for v1 simplicity (see roadmap discussion re: Pub/Sub push later).
    newMail: {
      outputSchema: z.object({ messages: z.array(z.any()) }),
      poll: async ({ connection, lastCheckedAt }) => {
        const gmail = gmailClient(connection);
        const afterEpoch = Math.floor(new Date(lastCheckedAt).getTime() / 1000);
        const list = await gmail.users.messages.list({
          userId: 'me',
          q: `after:${afterEpoch}`,
          maxResults: 20,
        });
        return { messages: list.data.messages || [] };
      },
    },
  },
};

function makeRawMessage({ to, subject, body }) {
  const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n');
  return Buffer.from(message).toString('base64url');
}
