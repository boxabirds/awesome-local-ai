/**
 * This client's id (story 9, text.created_by; story 10 reuses it for
 * shape.created_by): one stable id per tab for the lifetime of the tab.
 * It is client-only metadata, never synced.
 */
export const CLIENT_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
