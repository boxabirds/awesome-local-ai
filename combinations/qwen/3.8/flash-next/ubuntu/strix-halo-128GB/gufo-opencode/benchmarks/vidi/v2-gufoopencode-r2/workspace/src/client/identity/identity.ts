// Minimal per-tab guest identity, introduced by story 9 for `createdBy`.
// Story 6 (presence) owns the full useIdentity contract (names, colours,
// rename, persistence); until it lands, this module provides just the stable
// guest id, using story 6's id format. See NOTES.md.

// id format from story 6's design: 'g_' + 16 random bytes, base64url.
function makeGuestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `g_${base64}`;
}

export interface GuestIdentity {
  id: string;
}

let identity: GuestIdentity | null = null;

// Stable for the tab's lifetime: every object created here reports one id.
export function getIdentity(): GuestIdentity {
  if (identity === null) identity = { id: makeGuestId() };
  return identity;
}
