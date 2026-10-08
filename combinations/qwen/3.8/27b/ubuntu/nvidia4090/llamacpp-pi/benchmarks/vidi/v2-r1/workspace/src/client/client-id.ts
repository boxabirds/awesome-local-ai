// Client identity (story 9, text.create `createdBy`).
//
// Story 6 (user identity) is out of scope, so `createdBy` is an anonymous
// per-tab client id: generated once per tab (persisted in sessionStorage so
// a reload keeps the same id) and stable across objects created in the tab.
// It is not a user account; see NOTES.md.

const STORAGE_KEY = 'vidi6.clientId';

let cached: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The anonymous id of this client (per tab). */
export function getClientId(): string {
  if (cached !== null) return cached;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored !== null && stored !== '') {
      cached = stored;
      return cached;
    }
  } catch {
    // sessionStorage unavailable (private mode, jsdom without storage): use
    // an in-memory id.
  }
  const id = randomId();
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // best effort
  }
  cached = id;
  return id;
}
