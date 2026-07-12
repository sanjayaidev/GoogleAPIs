const { z } = require('zod');
const { Readable } = require('stream');
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

function driveClient(connection) {
  return google.drive({ version: 'v3', auth: getOAuthClient(connection) });
}

module.exports = {
  provider: 'google',
  // drive.file only sees files this app created/opened - broader than that
  // requires the full drive scope, which needs Google's sensitive-scope
  // verification for a production OAuth app. Using the full scope here so
  // listFiles/shareFile work against a user's existing files out of the box;
  // narrow this to drive.file if you don't need that and want to avoid
  // verification review.
  requiredScopes: [
    'https://www.googleapis.com/auth/drive',
  ],

  actions: {
    listFiles: {
      inputSchema: z.object({
        query: z.string().optional(), // Drive query syntax, e.g. "name contains 'report'"
        maxResults: z.number().int().min(1).max(100).optional().default(20),
      }),
      outputSchema: z.object({ files: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const res = await drive.files.list({
          q: input.query,
          pageSize: input.maxResults,
          fields: 'files(id, name, mimeType, webViewLink, modifiedTime, parents)',
        });
        return { files: res.data.files || [] };
      },
    },

    // Resource loaders for dropdowns - returns formatted options for files and folders
    getFiles: {
      inputSchema: z.object({
        mimeType: z.string().optional(),
        maxResults: z.number().int().min(1).max(100).optional().default(50),
      }),
      outputSchema: z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })) }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        let q = input.mimeType ? `mimeType='${input.mimeType}'` : '';
        const res = await drive.files.list({
          q: q || undefined,
          pageSize: input.maxResults,
          fields: 'files(id, name, mimeType)',
        });
        const options = (res.data.files || []).map(f => ({ value: f.id, label: f.name }));
        return { options };
      },
    },

    getFolders: {
      inputSchema: z.object({
        maxResults: z.number().int().min(1).max(100).optional().default(50),
      }),
      outputSchema: z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })) }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const res = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.folder'",
          pageSize: input.maxResults,
          fields: 'files(id, name)',
        });
        const options = (res.data.files || []).map(f => ({ value: f.id, label: f.name }));
        return { options };
      },
    },

    getFile: {
      inputSchema: z.object({ fileId: z.string() }),
      outputSchema: z.object({ file: z.any() }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const res = await drive.files.get({
          fileId: input.fileId,
          fields: 'id, name, mimeType, size, webViewLink, modifiedTime, parents',
        });
        return { file: res.data };
      },
    },

    uploadFile: {
      inputSchema: z.object({
        name: z.string(),
        mimeType: z.string().optional().default('text/plain'),
        content: z.string(), // plain text content; for binary, base64-encode upstream and set mimeType accordingly
        parentFolderId: z.string().optional(),
      }),
      outputSchema: z.object({ fileId: z.string(), webViewLink: z.string().optional() }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const res = await drive.files.create({
          requestBody: {
            name: input.name,
            parents: input.parentFolderId ? [input.parentFolderId] : undefined,
          },
          media: {
            mimeType: input.mimeType,
            body: Readable.from([input.content]),
          },
          fields: 'id, webViewLink',
        });
        return { fileId: res.data.id, webViewLink: res.data.webViewLink };
      },
    },

    createFolder: {
      inputSchema: z.object({
        name: z.string(),
        parentFolderId: z.string().optional(),
      }),
      outputSchema: z.object({ folderId: z.string() }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const res = await drive.files.create({
          requestBody: {
            name: input.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: input.parentFolderId ? [input.parentFolderId] : undefined,
          },
          fields: 'id',
        });
        return { folderId: res.data.id };
      },
    },

    deleteFile: {
      inputSchema: z.object({ fileId: z.string() }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        await drive.files.delete({ fileId: input.fileId });
        return { success: true };
      },
    },

    shareFile: {
      inputSchema: z.object({
        fileId: z.string(),
        email: z.string().email(),
        role: z.enum(['reader', 'commenter', 'writer']).optional().default('reader'),
      }),
      outputSchema: z.object({ permissionId: z.string().optional() }),
      handler: async ({ connection, input }) => {
        const drive = driveClient(connection);
        const res = await drive.permissions.create({
          fileId: input.fileId,
          requestBody: { type: 'user', role: input.role, emailAddress: input.email },
          fields: 'id',
        });
        return { permissionId: res.data.id };
      },
    },
  },

  triggers: {
    // Polling-based: files modified since the last check.
    changedFile: {
      outputSchema: z.object({ files: z.array(z.any()) }),
      poll: async ({ connection, lastCheckedAt }) => {
        const drive = driveClient(connection);
        const iso = new Date(lastCheckedAt).toISOString();
        const res = await drive.files.list({
          q: `modifiedTime > '${iso}'`,
          pageSize: 50,
          fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
        });
        return { files: res.data.files || [] };
      },
    },
  },
};
