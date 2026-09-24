/**
 * Story 9 · a minimal per-client identity.
 *
 * A text object records who created it (`createdBy`), and a later presence
 * feature (story 6) wants a stable "me" per tab. That is not implemented yet, so
 * this is the smallest thing that satisfies the need: one random id minted once
 * per tab, stable across re-renders and board changes but never shared between
 * tabs. It never touches the network and never persists — a reload mints a new
 * one, exactly like the personal undo history (story 8).
 */
import { useMemo } from 'react';

/** A short random identity id (no `crypto` dependency for exotic runtimes). */
function newIdentity(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `who-${Math.random().toString(36).slice(2, 10)}`;
}

/** The current client's identity id, created once per component instance. */
export function useIdentity(): { id: string } {
  return useMemo(() => ({ id: newIdentity() }), []);
}
