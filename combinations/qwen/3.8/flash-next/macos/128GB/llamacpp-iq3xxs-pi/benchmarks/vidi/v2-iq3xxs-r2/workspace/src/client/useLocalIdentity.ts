import { useMemo } from 'react';

/**
 * Who this tab is, for the object metadata that needs an author and nothing else does.
 *
 * Story 9 stores `createdBy` on a text object (the presence object of the design), but
 * story 6 — the one that hands out names like "Swift Fox" and puts a cursor on the board —
 * is not built yet. Rather than invent an identity twice, this is the smallest thing that
 * gives a text a stable author *for this tab*: a random id, made once, that survives every
 * re-render and every board on the tab, and is different in the next tab. When story 6
 * arrives it supplies the same string, and `createdBy` becomes a person with a name.
 *
 * `crypto` is missing, or lacks `randomUUID`, outside a secure context and in an environment
 * with no browser at all, so there is a fallback: nothing more than uniqueness per tab is
 * asked of it.
 */
function randomId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `local-${Math.random().toString(36).slice(2, 10)}`;
}

let tabIdentity: string | undefined;

/** This tab's id, made on first use and kept for the life of the tab. */
export function localIdentity(): string {
  tabIdentity ??= randomId();
  return tabIdentity;
}

/** The same id, as a hook, so a component reads it like everything else it depends on. */
export function useLocalIdentity(): string {
  return useMemo(() => localIdentity(), []);
}
