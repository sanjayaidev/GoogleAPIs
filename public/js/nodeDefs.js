// Node metadata for the canvas flow builder. One entry per backend module
// (src/modules/<name>.js). This mirrors each module's real inputSchema/
// triggers so what you build here maps 1:1 onto POST /flows steps -
// nothing here is decorative-only.
//
// field shape: { name, label, placeholder, type: 'text'|'number'|'select'|'checkbox'|'textarea',
//                options: [...] (for select), path: 'dot.path' (nested input), parse: 'csv'|'json' }

const NODE_DEFS = {
  gmail: {
    label: 'Gmail', icon: '✉️', color: '#ea4335',
    triggers: [
      { id: 'newMail', label: 'On new email', fields: [] },
    ],
    actions: [
      { id: 'loadMails', label: 'Search / load emails', fields: [
        { name: 'query', label: 'Search query', placeholder: 'is:unread' },
        { name: 'maxResults', label: 'Max results', placeholder: '10', type: 'number' },
      ]},
      { id: 'sendMail', label: 'Send email', fields: [
        { name: 'to', label: 'To' }, { name: 'subject', label: 'Subject' },
        { name: 'body', label: 'Body', type: 'textarea' },
      ]},
      { id: 'createDraft', label: 'Create draft', fields: [
        { name: 'to', label: 'To' }, { name: 'subject', label: 'Subject' },
        { name: 'body', label: 'Body', type: 'textarea' },
      ]},
      { id: 'reply', label: 'Reply to thread', fields: [
        { name: 'threadId', label: 'Select Email (thread)', type: 'resource', resourceType: 'gmailThread' },
        { name: 'to', label: 'To' },
        { name: 'subject', label: 'Subject' }, { name: 'body', label: 'Body', type: 'textarea' },
      ]},
      { id: 'markAsRead', label: 'Mark as read', fields: [
        { name: 'messageId', label: 'Select Email', type: 'resource', resourceType: 'gmailMessage' },
      ]},
      { id: 'addLabel', label: 'Add label', fields: [
        { name: 'messageId', label: 'Select Email', type: 'resource', resourceType: 'gmailMessage' },
        { name: 'labelId', label: 'Select Label', type: 'resource', resourceType: 'gmailLabel' },
      ]},
      // Resource loader actions for dropdowns
      { id: 'listLabels', label: 'List labels (for dropdown)', fields: [] },
    ],
  },

  sheets: {
    label: 'Google Sheets', icon: '📊', color: '#0f9d58',
    triggers: [
      // Inclusive trigger: "Trigger on" lets you check Added, Updated, or
      // both - no need to add two separate nodes for one sheet.
      { id: 'rowChange', label: 'On row added / updated', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'events', label: 'Trigger on', type: 'checkboxGroup', default: ['added', 'updated'], options: [
          { value: 'added', label: 'Row added' },
          { value: 'updated', label: 'Row updated' },
        ]},
      ]},
    ],
    actions: [
      { id: 'listSpreadsheets', label: 'List spreadsheets', fields: [
        { name: 'query', label: 'Search query (optional)', placeholder: 'budget' },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ]},
      { id: 'listSheets', label: 'List sheets in spreadsheet', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
      ]},
      { id: 'appendRow', label: 'Add a row', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range (sheet!cell)', placeholder: 'A1' },
        { name: 'values', label: 'Row values (comma separated)', placeholder: 'a, b, c', parse: 'csv' },
      ]},
      { id: 'deleteRow', label: 'Delete a row', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'rowNumber', label: 'Row number', type: 'number' },
      ]},
      { id: 'updateRange', label: 'Update a row/range', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range', placeholder: 'A2:C2' },
        { name: 'values', label: 'Values (JSON array of rows)', type: 'textarea', placeholder: '[["a","b","c"]]', parse: 'json' },
      ]},
      { id: 'getRow', label: 'Get row', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'rowNumber', label: 'Row number', type: 'number' },
      ]},
      { id: 'readRange', label: 'Get many rows (range)', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range', placeholder: 'A1:D20' },
      ]},
      { id: 'clearRange', label: 'Clear a range', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range' },
      ]},
      { id: 'createSpreadsheet', label: 'Create spreadsheet', fields: [
        { name: 'title', label: 'Title' },
        { name: 'sheetTitle', label: 'First sheet title', placeholder: 'Sheet1' },
      ]},
    ],
  },

  forms: {
    label: 'Google Forms', icon: '📝', color: '#673ab7',
    triggers: [
      { id: 'newResponse', label: 'On new response', fields: [
        { name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' },
      ]},
    ],
    actions: [
      { id: 'listForms', label: 'List forms', fields: [
        { name: 'query', label: 'Search query (optional)', placeholder: 'survey' },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '20' },
      ]},
      { id: 'createForm', label: 'Create form', fields: [
        { name: 'title', label: 'Title' }, { name: 'description', label: 'Description', type: 'textarea' },
      ]},
      { id: 'getForm', label: 'Get form', fields: [{ name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' }] },
      { id: 'addQuestion', label: 'Add question', fields: [
        { name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' },
        { name: 'title', label: 'Question title' },
        { name: 'type', label: 'Question type', type: 'select', options: ['TEXT','PARAGRAPH_TEXT','MULTIPLE_CHOICE','CHECKBOX','DROPDOWN'] },
        { name: 'options', label: 'Choices (comma separated)', parse: 'csv' },
        { name: 'required', label: 'Required', type: 'checkbox' },
        { name: 'index', label: 'Insert position', type: 'number', placeholder: '0' },
      ]},
      { id: 'listResponses', label: 'List responses', fields: [{ name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' }] },
    ],
  },

  drive: {
    label: 'Google Drive', icon: '📁', color: '#4285f4',
    triggers: [
      { id: 'changedFile', label: 'On file created/changed', fields: [] },
    ],
    actions: [
      { id: 'listFiles', label: 'List/search files', fields: [
        { name: 'query', label: 'Query', placeholder: "name contains 'report'" },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '20' },
      ]},
      { id: 'getFile', label: 'Get file', fields: [{ name: 'fileId', label: 'Select File', type: 'resource', resourceType: 'driveFile' }] },
      { id: 'uploadFile', label: 'Upload file', fields: [
        { name: 'name', label: 'File name' }, { name: 'mimeType', label: 'MIME type', placeholder: 'text/plain' },
        { name: 'content', label: 'Content', type: 'textarea' }, { name: 'parentFolderId', label: 'Parent folder ID', type: 'resource', resourceType: 'driveFolder' },
      ]},
      { id: 'createFolder', label: 'Create folder', fields: [
        { name: 'name', label: 'Folder name' }, { name: 'parentFolderId', label: 'Parent folder ID', type: 'resource', resourceType: 'driveFolder' },
      ]},
      { id: 'deleteFile', label: 'Delete file', fields: [{ name: 'fileId', label: 'Select File', type: 'resource', resourceType: 'driveFile' }] },
      { id: 'shareFile', label: 'Share file', fields: [
        { name: 'fileId', label: 'Select File', type: 'resource', resourceType: 'driveFile' }, { name: 'email', label: 'Share with (email)' },
        { name: 'role', label: 'Role', type: 'select', options: ['reader','commenter','writer'] },
      ]},
      // Resource loader actions for dropdowns
      { id: 'getFiles', label: 'Get files (for dropdown)', fields: [
        { name: 'mimeType', label: 'Filter by MIME type (optional)' },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ]},
      { id: 'getFolders', label: 'Get folders (for dropdown)', fields: [
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ]},
    ],
  },

  calendar: {
    label: 'Google Calendar', icon: '📅', color: '#1a73e8',
    triggers: [
      { id: 'updatedEvent', label: 'On event created/updated', fields: [] },
    ],
    actions: [
      { id: 'listCalendars', label: 'List calendars', fields: [] },
      { id: 'getCalendars', label: 'Get calendars (for dropdown)', fields: [] },
      { id: 'listEvents', label: 'List events', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' },
        { name: 'timeMin', label: 'Time min (RFC3339)' }, { name: 'timeMax', label: 'Time max (RFC3339)' },
        { name: 'maxResults', label: 'Max results', type: 'number' }, { name: 'query', label: 'Search query' },
      ]},
      { id: 'createEvent', label: 'Create event', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' },
        { name: 'summary', label: 'Summary' }, { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'location', label: 'Location' },
        { name: 'startDateTime', label: 'Start date/time', path: 'start.dateTime' },
        { name: 'endDateTime', label: 'End date/time', path: 'end.dateTime' },
        { name: 'attendees', label: 'Attendee emails (comma separated)', parse: 'csv' },
      ]},
      { id: 'updateEvent', label: 'Update event', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' }, { name: 'eventId', label: 'Event ID' },
        { name: 'summary', label: 'Summary' },
        { name: 'startDateTime', label: 'Start date/time', path: 'start.dateTime' },
        { name: 'endDateTime', label: 'End date/time', path: 'end.dateTime' },
      ]},
      { id: 'deleteEvent', label: 'Delete event', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' }, { name: 'eventId', label: 'Event ID' },
      ]},
    ],
  },

  docs: {
    label: 'Google Docs', icon: '📄', color: '#4285f4',
    triggers: [
      { id: 'documentChanged', label: 'On document changed', fields: [
        { name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' },
      ]},
    ],
    actions: [
      { id: 'listDocuments', label: 'List documents', fields: [
        { name: 'query', label: 'Extra Drive query (optional)', placeholder: "name contains 'report'" },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '20' },
      ]},
      { id: 'createDocument', label: 'Create document', fields: [
        { name: 'title', label: 'Title' }, { name: 'body', label: 'Body text', type: 'textarea' },
      ]},
      { id: 'getDocument', label: 'Get document', fields: [{ name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' }] },
      { id: 'appendText', label: 'Append text', fields: [
        { name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' }, { name: 'text', label: 'Text', type: 'textarea' },
      ]},
      { id: 'replaceAllText', label: 'Find & replace text', fields: [
        { name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' }, { name: 'findText', label: 'Find text' },
        { name: 'replaceText', label: 'Replace text' }, { name: 'matchCase', label: 'Match case', type: 'checkbox' },
      ]},
      // Resource loader action for dropdowns
      { id: 'getDocuments', label: 'Get documents (for dropdown)', fields: [
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ]},
    ],
  },

  googleBusinessProfile: {
    label: 'Business Profile', icon: '🏬', color: '#34a853',
    triggers: [
      { id: 'reviewsSnapshot', label: 'On new review (snapshot poll)', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
      ]},
    ],
    actions: [
      { id: 'listAccounts', label: 'List accounts', fields: [] },
      { id: 'listLocations', label: 'List locations', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'maxResults', label: 'Max results', type: 'number' },
      ]},
      { id: 'getLocation', label: 'Get location', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
      ]},
      { id: 'getDailyMetrics', label: 'Get daily metrics', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
        { name: 'metric', label: 'Metric', type: 'select', options: [
          'BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
          'BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
          'CALL_CLICKS','WEBSITE_CLICKS','BUSINESS_DIRECTION_REQUESTS',
        ]},
        { name: 'startDate', label: 'Start date', placeholder: '2026-07-01' },
        { name: 'endDate', label: 'End date', placeholder: '2026-07-12' },
      ]},
      { id: 'listReviews', label: 'List reviews', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
      ]},
      { id: 'replyToReview', label: 'Reply to review', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
        { name: 'reviewId', label: 'Select Review', type: 'resource', resourceType: 'gbpReview', dependsOn: 'accountId,locationId' },
        { name: 'comment', label: 'Reply comment', type: 'textarea' },
      ]},
      { id: 'deleteReviewReply', label: 'Delete review reply', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
        { name: 'reviewId', label: 'Select Review', type: 'resource', resourceType: 'gbpReview', dependsOn: 'accountId,locationId' },
      ]},
      { id: 'listPosts', label: 'List posts', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
      ]},
      { id: 'createPost', label: 'Create post', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
        { name: 'summary', label: 'Post text', type: 'textarea' },
        { name: 'topicType', label: 'Post type', type: 'select', options: ['STANDARD','EVENT','OFFER','ALERT'] },
        { name: 'actionUrl', label: 'Learn more URL (optional)' },
      ]},
      { id: 'deletePost', label: 'Delete post', fields: [
        { name: 'accountId', label: 'Select Account', type: 'resource', resourceType: 'gbpAccount' },
        { name: 'locationId', label: 'Select Location', type: 'resource', resourceType: 'gbpLocation', dependsOn: 'accountId' },
        { name: 'postId', label: 'Select Post', type: 'resource', resourceType: 'gbpPost', dependsOn: 'accountId,locationId' },
      ]},
    ],
  },
};

// module registry key -> display metadata above (drive/calendar/docs share
// icon color visually but are distinct backend modules).
const MODULE_ORDER = ['gmail', 'sheets', 'forms', 'drive', 'calendar', 'docs', 'googleBusinessProfile'];
