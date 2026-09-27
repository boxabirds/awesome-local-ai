// Story 9: the creating client's identity (text.model: `createdBy`).
//
// The text schema records who created an object. Story 6 (sign-in, which
// provides a real identity) is not part of this build, so each tab uses an
// anonymous id: one per browser tab (sessionStorage), stable across
// reconnects, different per tab.

let identityId: string | null = null;

/** The anonymous per-tab identity id (created once, then stable). */
export function getIdentityId(): string {
  if (identityId === null) {
    identityId = newAnonymousId();
  }
  return identityId;
}

function newAnonymousId(): string {
  try {
    const stored = window.sessionStorage.getItem('vidi6-identity');
    if (stored !== null && stored !== '') return stored;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem('vidi6-identity', id);
    return id;
  } catch {
    // sessionStorage unavailable (private mode, jsdom): fall back to a
    // fresh in-memory id.
    return crypto.randomUUID();
  }
}
