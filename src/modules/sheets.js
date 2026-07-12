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

function sheetsClient(connection) {
  return google.sheets({ version: 'v4', auth: getOAuthClient(connection) });
}

// A single cell value coming through JSON input - keep it permissive
// (string/number/boolean/null) rather than forcing everything to string.
const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

module.exports = {
  provider: 'google',
  requiredScopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],

  actions: {
    createSpreadsheet: {
      inputSchema: z.object({
        title: z.string(),
        sheetTitle: z.string().optional().default('Sheet1'),
      }),
      outputSchema: z.object({ spreadsheetId: z.string(), url: z.string() }),
      handler: async ({ connection, input }) => {
        const sheets = sheetsClient(connection);
        const res = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: input.title },
            sheets: [{ properties: { title: input.sheetTitle } }],
          },
        });
        return { spreadsheetId: res.data.spreadsheetId, url: res.data.spreadsheetUrl };
      },
    },

    readRange: {
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(), // e.g. "Sheet1!A1:D20"
      }),
      outputSchema: z.object({ values: z.array(z.array(cellValue)) }),
      handler: async ({ connection, input }) => {
        const sheets = sheetsClient(connection);
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: input.spreadsheetId,
          range: input.range,
        });
        return { values: res.data.values || [] };
      },
    },

    appendRow: {
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(), // e.g. "Sheet1!A1" - append finds the next free row itself
        values: z.array(cellValue),
      }),
      outputSchema: z.object({ updatedRange: z.string().optional() }),
      handler: async ({ connection, input }) => {
        const sheets = sheetsClient(connection);
        const res = await sheets.spreadsheets.values.append({
          spreadsheetId: input.spreadsheetId,
          range: input.range,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [input.values] },
        });
        return { updatedRange: res.data.updates?.updatedRange };
      },
    },

    updateRange: {
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
        values: z.array(z.array(cellValue)),
      }),
      outputSchema: z.object({ updatedCells: z.number().optional() }),
      handler: async ({ connection, input }) => {
        const sheets = sheetsClient(connection);
        const res = await sheets.spreadsheets.values.update({
          spreadsheetId: input.spreadsheetId,
          range: input.range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: input.values },
        });
        return { updatedCells: res.data.updatedCells };
      },
    },

    clearRange: {
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const sheets = sheetsClient(connection);
        await sheets.spreadsheets.values.clear({
          spreadsheetId: input.spreadsheetId,
          range: input.range,
        });
        return { success: true };
      },
    },

    getRow: {
      inputSchema: z.object({
        spreadsheetId: z.string(),
        sheetName: z.string().optional().default('Sheet1'),
        rowNumber: z.number().int().min(1),
      }),
      outputSchema: z.object({ values: z.array(cellValue) }),
      handler: async ({ connection, input }) => {
        const sheets = sheetsClient(connection);
        const range = `${input.sheetName}!${input.rowNumber}:${input.rowNumber}`;
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: input.spreadsheetId, range });
        return { values: (res.data.values || [])[0] || [] };
      },
    },

    deleteRow: {
      inputSchema: z.object({
        spreadsheetId: z.string(),
        sheetName: z.string().optional().default('Sheet1'),
        rowNumber: z.number().int().min(1),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const sheets = sheetsClient(connection);
        // deleteDimension needs the sheet's numeric grid id, not its title,
        // so look it up from the spreadsheet's metadata first.
        const meta = await sheets.spreadsheets.get({ spreadsheetId: input.spreadsheetId });
        const sheet = (meta.data.sheets || []).find(s => s.properties?.title === input.sheetName);
        if (!sheet) throw new Error(`Sheet "${input.sheetName}" not found`);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId: sheet.properties.sheetId,
                  dimension: 'ROWS',
                  startIndex: input.rowNumber - 1,
                  endIndex: input.rowNumber,
                },
              },
            }],
          },
        });
        return { success: true };
      },
    },
  },

  // Sheets has no native push mechanism for row-level changes, so these are
  // meant to be fed by a small Apps Script bound trigger (onChange/onEdit)
  // on the sheet, POSTing to /webhooks/generic/sheets with { secret, data }.
  // There's no poll() here on purpose - see routes/webhooks.js, and the
  // README's "not included yet" section for the receiving side (still a
  // TODO there - payload validation/routing to flows isn't wired up yet).
  triggers: {
    rowAdded: {
      kind: 'webhook',
      webhookSource: 'sheets',
      outputSchema: z.object({ sheetName: z.string(), rowNumber: z.number(), values: z.array(cellValue) }),
    },
    rowUpdated: {
      kind: 'webhook',
      webhookSource: 'sheets',
      outputSchema: z.object({ sheetName: z.string(), rowNumber: z.number(), values: z.array(cellValue) }),
    },
  },
};
