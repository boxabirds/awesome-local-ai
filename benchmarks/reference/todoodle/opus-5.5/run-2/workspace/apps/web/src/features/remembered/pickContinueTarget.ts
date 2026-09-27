import type { RememberedPublic } from '@todoodle/shared/schemas';

export type ContinueTarget = { id: string; name: string };

/** The most recently opened workspace this browser can still open, or null. Never an unavailable one. */
export function pickContinueTarget(list: RememberedPublic[]): ContinueTarget | null {
  for (const entry of list) {
    if (entry.available && entry.name !== null) return { id: entry.id, name: entry.name };
  }
  return null;
}
