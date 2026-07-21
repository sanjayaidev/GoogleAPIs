// Node metadata for the canvas flow builder. One entry per backend module
// (src/modules/<name>.js). This mirrors each module's real inputSchema/
// triggers so what you build here maps 1:1 onto POST /flows steps -
// nothing here is decorative-only.
//
// field shape: { name, label, placeholder, type: 'text'|'number'|'select'|'checkbox'|'textarea',
//                options: [...] (for select), path: 'dot.path' (nested input), parse: 'csv'|'json' }
//
// outputFields (additive metadata for the mapping picker): array of { label, path } describing
//   the output shape of this trigger/action. For array outputs (e.g. values, messages), use
//   dynamicColumns to signal index-based access (Column A/B/C or messages.0.subject, etc.).

const NODE_DEFS = {
  gmail: {
    label: 'Gmail', icon: '✉️', color: '#ea4335',
    triggers: [
      { id: 'newMail', label: 'On new email', fields: [],
        outputFields: [
          { label: 'Message ID', path: 'messages.0.id' },
          { label: 'Thread ID', path: 'messages.0.threadId' },
          { label: 'From', path: 'messages.0.from' },
          { label: 'Subject', path: 'messages.0.subject' },
          { label: 'Snippet', path: 'messages.0.snippet' },
          { label: 'Date', path: 'messages.0.date' },
        ],
      },
    ],
    actions: [
      { id: 'loadMails', label: 'Search / load emails', fields: [
        { name: 'query', label: 'Search query', placeholder: 'is:unread' },
        { name: 'maxResults', label: 'Max results', placeholder: '10', type: 'number' },
      ],
        outputFields: [
          { label: 'Message ID', path: 'messages.0.id' },
          { label: 'Thread ID', path: 'messages.0.threadId' },
          { label: 'From', path: 'messages.0.from' },
          { label: 'Subject', path: 'messages.0.subject' },
          { label: 'Snippet', path: 'messages.0.snippet' },
          { label: 'Date', path: 'messages.0.date' },
        ],
      },
      { id: 'sendMail', label: 'Send email', fields: [
        { name: 'to', label: 'To' }, { name: 'subject', label: 'Subject' },
        { name: 'body', label: 'Body', type: 'textarea' },
      ],
        outputFields: [
          { label: 'Message ID', path: 'messageId' },
          { label: 'Thread ID', path: 'threadId' },
          { label: 'Status', path: 'status' },
        ],
      },
      { id: 'createDraft', label: 'Create draft', fields: [
        { name: 'to', label: 'To' }, { name: 'subject', label: 'Subject' },
        { name: 'body', label: 'Body', type: 'textarea' },
      ],
        outputFields: [
          { label: 'Draft ID', path: 'draftId' },
          { label: 'Message ID', path: 'messageId' },
        ],
      },
      { id: 'reply', label: 'Reply to thread', fields: [
        { name: 'threadId', label: 'Select Email (thread)', type: 'resource', resourceType: 'gmailThread' },
        { name: 'to', label: 'To' },
        { name: 'subject', label: 'Subject' }, { name: 'body', label: 'Body', type: 'textarea' },
      ],
        outputFields: [
          { label: 'Message ID', path: 'messageId' },
          { label: 'Thread ID', path: 'threadId' },
          { label: 'Status', path: 'status' },
        ],
      },
      { id: 'markAsRead', label: 'Mark as read', fields: [
        { name: 'messageId', label: 'Select Email', type: 'resource', resourceType: 'gmailMessage' },
      ],
        outputFields: [
          { label: 'Message ID', path: 'messageId' },
          { label: 'Status', path: 'status' },
        ],
      },
      { id: 'addLabel', label: 'Add label', fields: [
        { name: 'messageId', label: 'Select Email', type: 'resource', resourceType: 'gmailMessage' },
        { name: 'labelId', label: 'Select Label', type: 'resource', resourceType: 'gmailLabel' },
      ],
        outputFields: [
          { label: 'Message ID', path: 'messageId' },
          { label: 'Label ID', path: 'labelId' },
          { label: 'Status', path: 'status' },
        ],
      },
      // Resource loader actions for dropdowns
      { id: 'listLabels', label: 'List labels (for dropdown)', fields: [],
        outputFields: [
          { label: 'Labels', path: 'labels' },
        ],
      },
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
      ],
        outputFields: [
          { label: 'Event type', path: 'eventType' },
          { label: 'Sheet name', path: 'sheetName' },
          { label: 'Row number', path: 'rowNumber' },
        ],
        dynamicColumns: { path: 'values', labelPrefix: 'Column' },
      },
    ],
    actions: [
      { id: 'listSpreadsheets', label: 'List spreadsheets', fields: [
        { name: 'query', label: 'Search query (optional)', placeholder: 'budget' },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ],
        outputFields: [
          { label: 'Spreadsheet ID', path: 'spreadsheets.0.spreadsheetId' },
          { label: 'Spreadsheet Name', path: 'spreadsheets.0.name' },
        ],
      },
      { id: 'listSheets', label: 'List sheets in spreadsheet', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
      ],
        outputFields: [
          { label: 'Sheet Name', path: 'sheets.0.properties.title' },
          { label: 'Sheet ID', path: 'sheets.0.properties.sheetId' },
        ],
      },
      { id: 'appendRow', label: 'Add a row', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range (sheet!cell)', placeholder: 'A1' },
        { name: 'values', label: 'Row values (comma separated)', placeholder: 'a, b, c', parse: 'csv' },
      ],
        outputFields: [
          { label: 'Updated Range', path: 'updates.updatedRange' },
          { label: 'Updated Rows', path: 'updates.updatedRows' },
          { label: 'Updated Columns', path: 'updates.updatedColumns' },
          { label: 'Updated Cells', path: 'updates.updatedCells' },
        ],
      },
      { id: 'deleteRow', label: 'Delete a row', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'rowNumber', label: 'Row number', type: 'number' },
      ],
        outputFields: [
          { label: 'Deleted Row', path: 'rowNumber' },
          { label: 'Status', path: 'status' },
        ],
      },
      { id: 'updateRange', label: 'Update a row/range', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range', placeholder: 'A2:C2' },
        { name: 'values', label: 'Values (JSON array of rows)', type: 'textarea', placeholder: '[["a","b","c"]]', parse: 'json' },
      ],
        outputFields: [
          { label: 'Updated Range', path: 'updates.updatedRange' },
          { label: 'Updated Rows', path: 'updates.updatedRows' },
          { label: 'Updated Columns', path: 'updates.updatedColumns' },
          { label: 'Updated Cells', path: 'updates.updatedCells' },
        ],
        dynamicColumns: { path: 'values', labelPrefix: 'Column' },
      },
      { id: 'getRow', label: 'Get row', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'rowNumber', label: 'Row number', type: 'number' },
      ],
        outputFields: [
          { label: 'Row Number', path: 'rowNumber' },
        ],
        dynamicColumns: { path: 'values', labelPrefix: 'Column' },
      },
      { id: 'readRange', label: 'Get many rows (range)', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range', placeholder: 'A1:D20' },
      ],
        outputFields: [
          { label: 'Range', path: 'range' },
        ],
        dynamicColumns: { path: 'values', labelPrefix: 'Column' },
      },
      { id: 'clearRange', label: 'Clear a range', fields: [
        { name: 'spreadsheetId', label: 'Select Spreadsheet', type: 'resource', resourceType: 'spreadsheet' },
        { name: 'sheetName', label: 'Select Sheet/Page', type: 'resource', resourceType: 'sheet', dependsOn: 'spreadsheetId' },
        { name: 'range', label: 'Range' },
      ],
        outputFields: [
          { label: 'Cleared Range', path: 'clearedRange' },
          { label: 'Status', path: 'status' },
        ],
      },
      { id: 'createSpreadsheet', label: 'Create spreadsheet', fields: [
        { name: 'title', label: 'Title' },
        { name: 'sheetTitle', label: 'First sheet title', placeholder: 'Sheet1' },
      ],
        outputFields: [
          { label: 'Spreadsheet ID', path: 'spreadsheetId' },
          { label: 'Spreadsheet Name', path: 'name' },
          { label: 'Sheet Name', path: 'sheets.0.properties.title' },
        ],
      },
    ],
  },

  forms: {
    label: 'Google Forms', icon: '📝', color: '#673ab7',
    triggers: [
      { id: 'newResponse', label: 'On new response', fields: [
        { name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' },
      ],
        outputFields: [
          { label: 'Response ID', path: 'responseId' },
          { label: 'Submit Time', path: 'submitTime' },
          { label: 'Answers', path: 'answers' },
        ],
      },
    ],
    actions: [
      { id: 'listForms', label: 'List forms', fields: [
        { name: 'query', label: 'Search query (optional)', placeholder: 'survey' },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '20' },
      ],
        outputFields: [
          { label: 'Form ID', path: 'forms.0.formId' },
          { label: 'Form Title', path: 'forms.0.info.title' },
        ],
      },
      { id: 'createForm', label: 'Create form', fields: [
        { name: 'title', label: 'Title' }, { name: 'description', label: 'Description', type: 'textarea' },
      ],
        outputFields: [
          { label: 'Form ID', path: 'formId' },
          { label: 'Form Title', path: 'info.title' },
        ],
      },
      { id: 'getForm', label: 'Get form', fields: [{ name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' }],
        outputFields: [
          { label: 'Form ID', path: 'formId' },
          { label: 'Form Title', path: 'info.title' },
          { label: 'Form Description', path: 'info.description' },
        ],
      },
      { id: 'addQuestion', label: 'Add question', fields: [
        { name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' },
        { name: 'title', label: 'Question title' },
        { name: 'type', label: 'Question type', type: 'select', options: ['TEXT','PARAGRAPH_TEXT','MULTIPLE_CHOICE','CHECKBOX','DROPDOWN'] },
        { name: 'options', label: 'Choices (comma separated)', parse: 'csv' },
        { name: 'required', label: 'Required', type: 'checkbox' },
        { name: 'index', label: 'Insert position', type: 'number', placeholder: '0' },
      ],
        outputFields: [
          { label: 'Question ID', path: 'questionId' },
          { label: 'Question Title', path: 'title' },
        ],
      },
      { id: 'listResponses', label: 'List responses', fields: [{ name: 'formId', label: 'Select Form', type: 'resource', resourceType: 'form' }],
        outputFields: [
          { label: 'Response ID', path: 'responses.0.responseId' },
          { label: 'Submit Time', path: 'responses.0.submitTime' },
        ],
      },
    ],
  },

  drive: {
    label: 'Google Drive', icon: '📁', color: '#4285f4',
    triggers: [
      { id: 'changedFile', label: 'On file created/changed', fields: [],
        outputFields: [
          { label: 'File ID', path: 'fileId' },
          { label: 'File Name', path: 'name' },
          { label: 'MIME Type', path: 'mimeType' },
          { label: 'Modified Time', path: 'modifiedTime' },
        ],
      },
    ],
    actions: [
      { id: 'listFiles', label: 'List/search files', fields: [
        { name: 'query', label: 'Query', placeholder: "name contains 'report'" },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '20' },
      ],
        outputFields: [
          { label: 'File ID', path: 'files.0.id' },
          { label: 'File Name', path: 'files.0.name' },
          { label: 'MIME Type', path: 'files.0.mimeType' },
        ],
      },
      { id: 'getFile', label: 'Get file', fields: [{ name: 'fileId', label: 'Select File', type: 'resource', resourceType: 'driveFile' }],
        outputFields: [
          { label: 'File ID', path: 'id' },
          { label: 'File Name', path: 'name' },
          { label: 'MIME Type', path: 'mimeType' },
          { label: 'Size', path: 'size' },
          { label: 'Created Time', path: 'createdTime' },
          { label: 'Modified Time', path: 'modifiedTime' },
        ],
      },
      { id: 'uploadFile', label: 'Upload file', fields: [
        { name: 'name', label: 'File name' }, { name: 'mimeType', label: 'MIME type', placeholder: 'text/plain' },
        { name: 'content', label: 'Content', type: 'textarea' }, { name: 'parentFolderId', label: 'Parent folder ID', type: 'resource', resourceType: 'driveFolder' },
      ],
        outputFields: [
          { label: 'File ID', path: 'id' },
          { label: 'File Name', path: 'name' },
          { label: 'MIME Type', path: 'mimeType' },
        ],
      },
      { id: 'createFolder', label: 'Create folder', fields: [
        { name: 'name', label: 'Folder name' }, { name: 'parentFolderId', label: 'Parent folder ID', type: 'resource', resourceType: 'driveFolder' },
      ],
        outputFields: [
          { label: 'Folder ID', path: 'id' },
          { label: 'Folder Name', path: 'name' },
        ],
      },
      { id: 'deleteFile', label: 'Delete file', fields: [{ name: 'fileId', label: 'Select File', type: 'resource', resourceType: 'driveFile' }],
        outputFields: [
          { label: 'File ID', path: 'fileId' },
          { label: 'Status', path: 'status' },
        ],
      },
      { id: 'shareFile', label: 'Share file', fields: [
        { name: 'fileId', label: 'Select File', type: 'resource', resourceType: 'driveFile' }, { name: 'email', label: 'Share with (email)' },
        { name: 'role', label: 'Role', type: 'select', options: ['reader','commenter','writer'] },
      ],
        outputFields: [
          { label: 'Permission ID', path: 'permissionId' },
          { label: 'Status', path: 'status' },
        ],
      },
      // Resource loader actions for dropdowns
      { id: 'getFiles', label: 'Get files (for dropdown)', fields: [
        { name: 'mimeType', label: 'Filter by MIME type (optional)' },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ],
        outputFields: [
          { label: 'File ID', path: 'files.0.id' },
          { label: 'File Name', path: 'files.0.name' },
        ],
      },
      { id: 'getFolders', label: 'Get folders (for dropdown)', fields: [
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ],
        outputFields: [
          { label: 'Folder ID', path: 'files.0.id' },
          { label: 'Folder Name', path: 'files.0.name' },
        ],
      },
    ],
  },

  calendar: {
    label: 'Google Calendar', icon: '📅', color: '#1a73e8',
    triggers: [
      { id: 'updatedEvent', label: 'On event created/updated', fields: [],
        outputFields: [
          { label: 'Event ID', path: 'eventId' },
          { label: 'Summary', path: 'summary' },
          { label: 'Description', path: 'description' },
          { label: 'Start', path: 'start.dateTime' },
          { label: 'End', path: 'end.dateTime' },
          { label: 'Location', path: 'location' },
          { label: 'Attendees', path: 'attendees' },
        ],
      },
    ],
    actions: [
      { id: 'listCalendars', label: 'List calendars', fields: [],
        outputFields: [
          { label: 'Calendar ID', path: 'items.0.id' },
          { label: 'Calendar Summary', path: 'items.0.summary' },
        ],
      },
      { id: 'getCalendars', label: 'Get calendars (for dropdown)', fields: [],
        outputFields: [
          { label: 'Calendar ID', path: 'items.0.id' },
          { label: 'Calendar Summary', path: 'items.0.summary' },
        ],
      },
      { id: 'listEvents', label: 'List events', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' },
        { name: 'timeMin', label: 'Time min (RFC3339)' }, { name: 'timeMax', label: 'Time max (RFC3339)' },
        { name: 'maxResults', label: 'Max results', type: 'number' }, { name: 'query', label: 'Search query' },
      ],
        outputFields: [
          { label: 'Event ID', path: 'items.0.id' },
          { label: 'Summary', path: 'items.0.summary' },
          { label: 'Start', path: 'items.0.start.dateTime' },
          { label: 'End', path: 'items.0.end.dateTime' },
        ],
      },
      { id: 'createEvent', label: 'Create event', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' },
        { name: 'summary', label: 'Summary' }, { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'location', label: 'Location' },
        { name: 'startDateTime', label: 'Start date/time', path: 'start.dateTime' },
        { name: 'endDateTime', label: 'End date/time', path: 'end.dateTime' },
        { name: 'attendees', label: 'Attendee emails (comma separated)', parse: 'csv' },
      ],
        outputFields: [
          { label: 'Event ID', path: 'id' },
          { label: 'Summary', path: 'summary' },
          { label: 'Start', path: 'start.dateTime' },
          { label: 'End', path: 'end.dateTime' },
          { label: 'HTML Link', path: 'htmlLink' },
        ],
      },
      { id: 'updateEvent', label: 'Update event', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' }, { name: 'eventId', label: 'Event ID' },
        { name: 'summary', label: 'Summary' },
        { name: 'startDateTime', label: 'Start date/time', path: 'start.dateTime' },
        { name: 'endDateTime', label: 'End date/time', path: 'end.dateTime' },
      ],
        outputFields: [
          { label: 'Event ID', path: 'id' },
          { label: 'Summary', path: 'summary' },
          { label: 'Start', path: 'start.dateTime' },
          { label: 'End', path: 'end.dateTime' },
        ],
      },
      { id: 'deleteEvent', label: 'Delete event', fields: [
        { name: 'calendarId', label: 'Select Calendar', type: 'resource', resourceType: 'calendar', placeholder: 'primary' }, { name: 'eventId', label: 'Event ID' },
      ],
        outputFields: [
          { label: 'Event ID', path: 'eventId' },
          { label: 'Status', path: 'status' },
        ],
      },
    ],
  },

  docs: {
    label: 'Google Docs', icon: '📄', color: '#4285f4',
    triggers: [
      { id: 'documentChanged', label: 'On document changed', fields: [
        { name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' },
      ],
        outputFields: [
          { label: 'Document ID', path: 'documentId' },
          { label: 'Document Title', path: 'title' },
          { label: 'Revision ID', path: 'revisionId' },
        ],
      },
    ],
    actions: [
      { id: 'listDocuments', label: 'List documents', fields: [
        { name: 'query', label: 'Extra Drive query (optional)', placeholder: "name contains 'report'" },
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '20' },
      ],
        outputFields: [
          { label: 'Document ID', path: 'files.0.id' },
          { label: 'Document Title', path: 'files.0.name' },
        ],
      },
      { id: 'createDocument', label: 'Create document', fields: [
        { name: 'title', label: 'Title' }, { name: 'body', label: 'Body text', type: 'textarea' },
      ],
        outputFields: [
          { label: 'Document ID', path: 'documentId' },
          { label: 'Document Title', path: 'title' },
        ],
      },
      { id: 'getDocument', label: 'Get document', fields: [{ name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' }],
        outputFields: [
          { label: 'Document ID', path: 'documentId' },
          { label: 'Document Title', path: 'title' },
          { label: 'Body Content', path: 'body.content' },
        ],
      },
      { id: 'appendText', label: 'Append text', fields: [
        { name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' }, { name: 'text', label: 'Text', type: 'textarea' },
      ],
        outputFields: [
          { label: 'Document ID', path: 'documentId' },
          { label: 'Write Control', path: 'writeControl' },
        ],
      },
      { id: 'replaceAllText', label: 'Find & replace text', fields: [
        { name: 'documentId', label: 'Select Document', type: 'resource', resourceType: 'document' }, { name: 'findText', label: 'Find text' },
        { name: 'replaceText', label: 'Replace text' }, { name: 'matchCase', label: 'Match case', type: 'checkbox' },
      ],
        outputFields: [
          { label: 'Occurrences Replaced', path: 'occurrencesChanged' },
          { label: 'Document ID', path: 'documentId' },
        ],
      },
      // Resource loader action for dropdowns
      { id: 'getDocuments', label: 'Get documents (for dropdown)', fields: [
        { name: 'maxResults', label: 'Max results', type: 'number', placeholder: '50' },
      ],
        outputFields: [
          { label: 'Document ID', path: 'files.0.id' },
          { label: 'Document Title', path: 'files.0.name' },
        ],
      },
    ],
  },
  httpRequest: {
    label: 'HTTP Request', icon: '🌐', color: '#6b7280',
    noAuth: true, // no OAuth connection - works purely off the fields below
    triggers: [],
    actions: [
      { id: 'request', label: 'Make a request', fields: [
        { name: 'method', label: 'Method', type: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        { name: 'url', label: 'URL', placeholder: 'https://api.example.com/endpoint' },
        { name: 'headers', label: 'Headers (JSON object)', type: 'textarea', placeholder: '{"Authorization": "Bearer ..."}', parse: 'json' },
        { name: 'body', label: 'Body (JSON, or map a value in)', type: 'textarea', placeholder: '{"key": "value"}', parse: 'json' },
      ],
        outputFields: [
          { label: 'Status Code', path: 'statusCode' },
          { label: 'Headers', path: 'headers' },
          { label: 'Response Body', path: 'body' },
        ],
      },
    ],
  },
};

// module registry key -> display metadata above (drive/calendar/docs share
// icon color visually but are distinct backend modules).
const MODULE_ORDER = ['gmail', 'sheets', 'forms', 'drive', 'calendar', 'docs', 'httpRequest'];
