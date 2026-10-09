// Story 9: identity source for `createdBy` until story 6 (sign-in) lands.
// One id per page load, stable across renders; persisted nowhere. Story 6
// will replace this with the real identity hook.

let sessionId: string | null = null;

export function getSessionId(): string {
  if (sessionId === null) {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    sessionId = c !== undefined && typeof c.randomUUID === 'function' ? c.randomUUID() : 'g_' + Math.random().toString(36).slice(2);
  }
  return sessionId;
}
