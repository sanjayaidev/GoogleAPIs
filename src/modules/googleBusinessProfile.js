const { z } = require('zod');
const { google } = require('googleapis');
const env = require('../config/env');

/**
 * Google Business Profile is split across several purpose-specific APIs
 * (the old monolithic "Google My Business API v4" was broken up in 2022).
 * This module uses:
 *   - mybusinessaccountmanagement v1 -> list/get accounts
 *   - mybusinessbusinessinformation v1 -> list/get/update locations
 *   - businessprofileperformance v1  -> daily metrics
 *   - mybusiness v4 (legacy, REST-only - not bundled in the googleapis SDK)
 *     -> reviews. Reviews and local Posts are the one area that never moved
 *     off the v4 surface, so we call it directly with the OAuth2 client's
 *     authenticated request() rather than a generated client.
 *
 * IMPORTANT - access is gated: unlike Gmail/Calendar/etc, these APIs are
 * NOT open by default on a new Google Cloud project. You must submit an
 * access request (Business Profile APIs -> request access), show a
 * legitimate use case, and have a Business Profile that's been verified
 * and active for 60+ days with a matching business website. Until that's
 * approved, every call below will fail with a permission error even with
 * valid OAuth tokens and the right scope.
 */

const MYBUSINESS_V4_BASE = 'https://mybusiness.googleapis.com/v4';

function getOAuthClient(connection) {
  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
  client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  });
  return client;
}

function accountManagementClient(connection) {
  return google.mybusinessaccountmanagement({ version: 'v1', auth: getOAuthClient(connection) });
}

function businessInfoClient(connection) {
  return google.mybusinessbusinessinformation({ version: 'v1', auth: getOAuthClient(connection) });
}

function performanceClient(connection) {
  return google.businessprofileperformance({ version: 'v1', auth: getOAuthClient(connection) });
}

// Legacy v4 REST call for reviews (no SDK bindings available).
async function mybusinessV4Request(connection, { method = 'GET', path, body }) {
  const client = getOAuthClient(connection);
  const res = await client.requestAsync({
    method,
    url: `${MYBUSINESS_V4_BASE}${path}`,
    data: body,
  });
  return res.data;
}

module.exports = {
  provider: 'google',
  requiredScopes: [
    'https://www.googleapis.com/auth/business.manage',
  ],

  actions: {
    listAccounts: {
      inputSchema: z.object({}),
      outputSchema: z.object({ accounts: z.array(z.any()) }),
      handler: async ({ connection }) => {
        const am = accountManagementClient(connection);
        const res = await am.accounts.list();
        return { accounts: res.data.accounts || [] };
      },
    },

    listLocations: {
      inputSchema: z.object({
        accountId: z.string(), // e.g. "accounts/123456789"
        maxResults: z.number().int().min(1).max(100).optional().default(20),
      }),
      outputSchema: z.object({ locations: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const bi = businessInfoClient(connection);
        const res = await bi.accounts.locations.list({
          parent: input.accountId,
          pageSize: input.maxResults,
          readMask: 'name,title,storefrontAddress,phoneNumbers,websiteUri,metadata',
        });
        return { locations: res.data.locations || [] };
      },
    },

    getLocation: {
      inputSchema: z.object({ locationId: z.string() }), // e.g. "locations/987654321"
      outputSchema: z.object({ location: z.any() }),
      handler: async ({ connection, input }) => {
        const bi = businessInfoClient(connection);
        const res = await bi.locations.get({
          name: input.locationId,
          readMask: 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,metadata',
        });
        return { location: res.data };
      },
    },

    getDailyMetrics: {
      inputSchema: z.object({
        locationId: z.string(), // e.g. "locations/987654321"
        metric: z.enum([
          'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
          'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
          'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
          'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
          'CALL_CLICKS',
          'WEBSITE_CLICKS',
          'BUSINESS_DIRECTION_REQUESTS',
        ]),
        startDate: z.string(), // YYYY-MM-DD
        endDate: z.string(),
      }),
      outputSchema: z.object({ timeSeries: z.any() }),
      handler: async ({ connection, input }) => {
        const perf = performanceClient(connection);
        const [locationOnly] = input.locationId.split('/').slice(-1);
        const [sy, sm, sd] = input.startDate.split('-').map(Number);
        const [ey, em, ed] = input.endDate.split('-').map(Number);

        const res = await perf.locations.getDailyMetricsTimeSeries({
          location: `locations/${locationOnly}`,
          dailyMetric: input.metric,
          'dailyRange.startDate.year': sy,
          'dailyRange.startDate.month': sm,
          'dailyRange.startDate.day': sd,
          'dailyRange.endDate.year': ey,
          'dailyRange.endDate.month': em,
          'dailyRange.endDate.day': ed,
        });
        return { timeSeries: res.data.timeSeries };
      },
    },

    // --- Reviews (legacy v4 REST - no SDK bindings) ---

    listReviews: {
      inputSchema: z.object({
        accountId: z.string(), // e.g. "accounts/123456789"
        locationId: z.string(), // e.g. "locations/987654321"
      }),
      outputSchema: z.object({ reviews: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const data = await mybusinessV4Request(connection, {
          path: `/${input.accountId}/${input.locationId}/reviews`,
        });
        return { reviews: data.reviews || [] };
      },
    },

    replyToReview: {
      inputSchema: z.object({
        accountId: z.string(),
        locationId: z.string(),
        reviewId: z.string(),
        comment: z.string(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        await mybusinessV4Request(connection, {
          method: 'PUT',
          path: `/${input.accountId}/${input.locationId}/reviews/${input.reviewId}/reply`,
          body: { comment: input.comment },
        });
        return { success: true };
      },
    },

    deleteReviewReply: {
      inputSchema: z.object({
        accountId: z.string(),
        locationId: z.string(),
        reviewId: z.string(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        await mybusinessV4Request(connection, {
          method: 'DELETE',
          path: `/${input.accountId}/${input.locationId}/reviews/${input.reviewId}/reply`,
        });
        return { success: true };
      },
    },

    // --- Local Posts (legacy v4 REST - same surface as reviews) ---

    listPosts: {
      inputSchema: z.object({
        accountId: z.string(), // e.g. "accounts/123456789"
        locationId: z.string(), // e.g. "locations/987654321"
      }),
      outputSchema: z.object({ posts: z.array(z.any()) }),
      handler: async ({ connection, input }) => {
        const data = await mybusinessV4Request(connection, {
          path: `/${input.accountId}/${input.locationId}/localPosts`,
        });
        return { posts: data.localPosts || [] };
      },
    },

    createPost: {
      inputSchema: z.object({
        accountId: z.string(),
        locationId: z.string(),
        summary: z.string(),
        // STANDARD is the plain update-style post; EVENT/OFFER/ALERT need
        // extra fields the legacy v4 API supports but this starter doesn't
        // expose yet - keep it simple and add those later if needed.
        topicType: z.enum(['STANDARD', 'EVENT', 'OFFER', 'ALERT']).optional().default('STANDARD'),
        actionUrl: z.string().optional(),
      }),
      outputSchema: z.object({ post: z.any() }),
      handler: async ({ connection, input }) => {
        const body = {
          languageCode: 'en-US',
          summary: input.summary,
          topicType: input.topicType,
        };
        if (input.actionUrl) {
          body.callToAction = { actionType: 'LEARN_MORE', url: input.actionUrl };
        }
        const data = await mybusinessV4Request(connection, {
          method: 'POST',
          path: `/${input.accountId}/${input.locationId}/localPosts`,
          body,
        });
        return { post: data };
      },
    },

    deletePost: {
      inputSchema: z.object({
        accountId: z.string(),
        locationId: z.string(),
        postId: z.string(), // the post's short name, e.g. "localPosts/abc123"
      }),
      outputSchema: z.object({ success: z.boolean() }),
      handler: async ({ connection, input }) => {
        await mybusinessV4Request(connection, {
          method: 'DELETE',
          path: `/${input.accountId}/${input.locationId}/localPosts/${input.postId}`,
        });
        return { success: true };
      },
    },
  },

  triggers: {
    // Polling-based: reviews list has no updatedMin filter in v4, so this
    // pulls all reviews each poll and lets the flow runner / caller diff
    // against what it's already seen (e.g. by review id).
    reviewsSnapshot: {
      outputSchema: z.object({ reviews: z.array(z.any()) }),
      poll: async ({ connection, input }) => {
        const data = await mybusinessV4Request(connection, {
          path: `/${input.accountId}/${input.locationId}/reviews`,
        });
        return { reviews: data.reviews || [] };
      },
    },
  },
};
