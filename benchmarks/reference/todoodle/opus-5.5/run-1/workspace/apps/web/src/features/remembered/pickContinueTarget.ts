import type { RememberedPublic } from '@todoodle/shared/schemas';

export type ContinueTarget = { id: string; name: string };

/**
 * The most recently opened workspace that still opens, or null. The list is already most-recent-first,
 * so the first available entry wins (js-early-exit). Never an unavailable one.
 */
export function pickContinueTarget(list: RememberedPublic[]): ContinueTarget | null {
  for (const entry of list) {
    if (entry.available && entry.name !== null) return { id: entry.id, name: entry.name };
  }
  return null;
}
