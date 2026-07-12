const { z } = require('zod');
const { google } = require('googleapis');
const env = require('../config/env');

/**
 * Same contract as gmail.js: { provider, requiredScopes, actions, triggers }.
 */

function getOAuthClient(connection) {
  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
  client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });
  return client;
}

function calendarClient(connection) {
  return google.calendar({ version: 'v3', auth: getOAuthClient(connection) });
}

const eventTimeSchema = z.object({
  dateTime: z.string().optional(), // RFC3339, e.g. 2026-07-15T09:00:00-07:00
  date: z.string().optional(), // YYYY-MM-DD for all-day events
  timeZone: z.string().optional(),
}).refine((v) => v.dateTime || v.date, { message: 'Provide either dateTime or date' });

module.exports = {
  provider: 'google',
  // calendar scopes + drive for listing calendars (needs full drive scope to access user's calendars)
  requiredScopes: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive',
  ],

  actions: {
    listCalendars: {
      inputSchema: z.object({}),
      outputSchema: z.object({ calendars: z.array(z.any()) }),
      handler: async ({ connection }) => {
        const calendar = calendarClient(connection);
        const res = await calendar.calendarList.list();
        return { calendars: (res.data.items || []).map(c => ({ id: c.id, name: c.summary, accessRole: c.accessRole })) };
      },
    },

    // Resource loader for calendar dropdown - returns same data but named for UI consistency
    getCalendars: {
      inputSchema: z.object({}),
      outputSchema: z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })) }),
      handler: async ({ connection }) => {
        const calendar = calendarClient(connection);
        const res = await calendar.calendarList.list();
        const options = (res.data.items || []).map(c => ({ value: c.id, label: c.summary }));
        return { options };
      },
    },

    listEvents: {
      inputSchema: z.object({
        calendarId: z.string().optional().default('primary'),
        timeMin: z.string().optional(), // RFC3339; defaults to now
        timeMax: z.string().optional(),
        maxResults: z.number().int().min(1).max(50).optional().default(10),
        query: z.string().optional(),
      }),
      outputSchema: z.object({ events: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const calendar = calendarClient(connection);
        const res = await calendar.events.list({
          calendarId: input.calendarId,
          timeMin: input.timeMin || new Date().toISOString(),
          timeMax: input.timeMax,
          maxResults: input.maxResults,
          q: input.query,
          singleEvents: true,
          orderBy: 'startTime',
        });
        return { events: res.data.items || [] };
      },
    },

    createEvent: {
      inputSchema: z.object({
        calendarId: z.string().optional().default('primary'),
        summary: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: eventTimeSchema,
        end: eventTimeSchema,
        attendees: z.array(z.string().email()).optional().default([]),
      }),
      outputSchema: z.object({ eventId: z.string(), htmlLink: z.string().optional() }),
      handler: async ({ connection, input }) => {
        const calendar = calendarClient(connection);
        const res = await calendar.events.insert({
          calendarId: input.calendarId,
          requestBody: {
            summary: input.summary,
            description: input.description,
            location: input.location,
            start: input.start,
            end: input.end,
            attendees: input.attendees.map((email) => ({ email })),
          },
        });
        return { eventId: res.data.id, htmlLink: res.data.htmlLink };
      },
    },

    updateEvent: {
      inputSchema: z.object({
        calendarId: z.string().optional().default('primary'),
        eventId: z.string(),
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: eventTimeSchema.optional(),
        end: eventTimeSchema.optional(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const calendar = calendarClient(connection);
        const { calendarId, eventId, ...patch } = input;
        await calendar.events.patch({ calendarId, eventId, requestBody: patch });
        return { success: true };
      },
    },

    deleteEvent: {
      inputSchema: z.object({
        calendarId: z.string().optional().default('primary'),
        eventId: z.string(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        const calendar = calendarClient(connection);
        await calendar.events.delete({ calendarId: input.calendarId, eventId: input.eventId });
        return { success: true };
      },
    },
  },

  triggers: {
    // Polling-based: pulls events updated since the last check via updatedMin.
    updatedEvent: {
      outputSchema: z.object({ events: z.array(z.any()) }),
      poll: async ({ connection, lastCheckedAt }) => {
        const calendar = calendarClient(connection);
        const res = await calendar.events.list({
          calendarId: 'primary',
          updatedMin: new Date(lastCheckedAt).toISOString(),
          singleEvents: true,
          showDeleted: true,
          maxResults: 50,
        });
        return { events: res.data.items || [] };
      },
    },
  },
};
