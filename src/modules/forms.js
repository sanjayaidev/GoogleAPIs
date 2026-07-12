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

function formsClient(connection) {
  return google.forms({ version: 'v1', auth: getOAuthClient(connection) });
}

module.exports = {
  provider: 'google',
  // forms scopes + drive for listing forms (needs full drive scope to access user's forms)
  requiredScopes: [
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.responses.readonly',
    'https://www.googleapis.com/auth/drive',
  ],

  actions: {
    listForms: {
      inputSchema: z.object({
        query: z.string().optional(),
        maxResults: z.number().int().min(1).max(100).optional().default(20),
      }),
      outputSchema: z.object({ forms: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const drive = google.drive({ version: 'v3', auth: getOAuthClient(connection) });
        const res = await drive.files.list({
          q: input.query ? `${input.query} and mimeType='application/vnd.google-apps.form'` : "mimeType='application/vnd.google-apps.form'",
          pageSize: input.maxResults,
          fields: 'files(id, name, webViewLink, modifiedTime)',
        });
        return { forms: res.data.files || [] };
      },
    },

    createForm: {
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional(),
      }),
      outputSchema: z.object({ formId: z.string(), responderUri: z.string().optional() }),
      handler: async ({ connection, input }) => {
        const forms = formsClient(connection);
        // The create call only accepts info.title - description and every
        // other field is set afterward via batchUpdate.
        const created = await forms.forms.create({ requestBody: { info: { title: input.title } } });
        const formId = created.data.formId;

        if (input.description) {
          await forms.forms.batchUpdate({
            formId,
            requestBody: {
              requests: [{
                updateFormInfo: {
                  info: { description: input.description },
                  updateMask: 'description',
                },
              }],
            },
          });
        }

        return { formId, responderUri: created.data.responderUri };
      },
    },

    getForm: {
      inputSchema: z.object({ formId: z.string() }),
      outputSchema: z.object({ form: z.any() }),
      handler: async ({ connection, input }) => {
        const forms = formsClient(connection);
        const res = await forms.forms.get({ formId: input.formId });
        return { form: res.data };
      },
    },

    addQuestion: {
      inputSchema: z.object({
        formId: z.string(),
        title: z.string(),
        type: z.enum(['TEXT', 'PARAGRAPH_TEXT', 'MULTIPLE_CHOICE', 'CHECKBOX', 'DROPDOWN']),
        options: z.array(z.string()).optional().default([]), // for choice-based types
        required: z.boolean().optional().default(false),
        index: z.number().int().min(0).optional().default(0), // position to insert at
      }),
      outputSchema: z.object({ itemId: z.string().optional() }),
      handler: async ({ connection, input }) => {
        const forms = formsClient(connection);

        let questionBody;
        if (input.type === 'TEXT' || input.type === 'PARAGRAPH_TEXT') {
          questionBody = { textQuestion: { paragraph: input.type === 'PARAGRAPH_TEXT' } };
        } else {
          const choiceType = input.type === 'DROPDOWN' ? 'DROP_DOWN' : input.type;
          questionBody = {
            choiceQuestion: {
              type: choiceType,
              options: input.options.map((value) => ({ value })),
            },
          };
        }

        const res = await forms.forms.batchUpdate({
          formId: input.formId,
          requestBody: {
            requests: [{
              createItem: {
                item: {
                  title: input.title,
                  questionItem: { question: { required: input.required, ...questionBody } },
                },
                location: { index: input.index },
              },
            }],
          },
        });

        const itemId = res.data.replies?.[0]?.createItem?.itemId;
        return { itemId };
      },
    },

    listResponses: {
      inputSchema: z.object({ formId: z.string() }),
      outputSchema: z.object({ responses: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const forms = formsClient(connection);
        const res = await forms.forms.responses.list({ formId: input.formId });
        return { responses: res.data.responses || [] };
      },
    },
  },

  triggers: {
    // Polling-based: responses submitted since the last check.
    newResponse: {
      outputSchema: z.object({ responses: z.array(z.any()) }),
      poll: async ({ connection, input, lastCheckedAt }) => {
        const forms = formsClient(connection);
        const res = await forms.forms.responses.list({
          formId: input.formId,
          filter: `timestamp > ${new Date(lastCheckedAt).toISOString()}`,
        });
        return { responses: res.data.responses || [] };
      },
    },
  },
};
