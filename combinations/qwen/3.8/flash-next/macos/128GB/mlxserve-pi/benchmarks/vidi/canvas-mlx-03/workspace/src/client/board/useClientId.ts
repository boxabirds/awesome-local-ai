// A minimal per-tab identity for stamping `createdBy` on newly created objects
// (story 9). Story 6's full presence/identity is out of scope for this build, so
// this is deliberately the smallest thing that gives a text object an author: one
// random id per browser tab, generated once for the tab's lifetime and never
// persisted or shared. See NOTES.md.

import { useMemo } from 'react';

/** A stable id for this tab, created once and reused for every object it makes. */
export function useClientId(): string {
  return useMemo(() => `g_${Math.random().toString(36).slice(2, 10)}`, []);
}
