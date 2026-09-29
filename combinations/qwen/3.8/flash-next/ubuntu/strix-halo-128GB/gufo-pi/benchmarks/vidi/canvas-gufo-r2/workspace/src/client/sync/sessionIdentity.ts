/**
 * This page session's identity (story 12).
 *
 * There is no account system: the board only needs to know which objects *this*
 * session created, so an interrupted upload can offer its owner the Retry
 * control while everyone else sees a plain "Image unavailable" box. The id lives
 * in memory, so a reload starts a fresh identity — exactly the case where Retry
 * must disappear and only Remove remains.
 */
function generate(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export const SESSION_IDENTITY: string = generate();
