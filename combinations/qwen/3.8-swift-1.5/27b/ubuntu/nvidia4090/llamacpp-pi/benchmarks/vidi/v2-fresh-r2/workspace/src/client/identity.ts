/**
 * Anonymous per-session identity (story 9).
 *
 * Story 6 (named identity and presence) is not in this build; text objects
 * record `createdBy` so the data model is ready. Each browser session gets
 * one random anonymous id, stable for the life of the tab.
 */

let sessionId: string | null = null;

/** The anonymous id for this session (created on first use). */
export function sessionIdentity(): string {
  if (!sessionId) {
    sessionId = `anon_${crypto.randomUUID()}`;
  }
  return sessionId;
}
