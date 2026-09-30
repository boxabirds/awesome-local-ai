// Who this tab is (`text.model`, `createdBy`).
//
// Story 6 (who is on the board) is not built yet, so there is no name, no colour and
// no avatar to put on an object. What a text object still wants is the thing
// `createdBy` is for: a note of who made it, so that when story 6 arrives there is
// something to attach the presence to instead of a schema change. It is:
//
//   - **per tab**, not per person: a second tab on the same machine is a second
//     stranger until story 6 says otherwise;
//   - **stable for the tab's life**, so fifty text objects made in one sitting say
//     the same thing;
//   - **nothing anyone proves**: it is a label, not a credential, and nothing about
//     what a person may do comes from it.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import { useMemo } from 'react';

const STORAGE_KEY = 'vidi6.localIdentity';

export interface LocalIdentity {
  /** This tab's id, used as a text object's `createdBy`. */
  id: string;
}

const randomId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    // A runtime with no randomUUID still gets an id that is different per tab; the
    // shape does not matter, nothing is derived from it.
    : `local-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

const stored = (): string => {
  const fresh = randomId();
  try {
    const existing =
      typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (typeof existing === 'string' && existing.length > 0) return existing;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    // A storage that will not answer (private mode, no DOM) gets the id for this
    // render only, which is all `createdBy` needs in a test.
    return fresh;
  }
  return fresh;
};

/** This tab's identity, made once and kept for as long as the tab lives. */
export function createLocalIdentity(): LocalIdentity {
  return { id: stored() };
}

/** The same identity for every render of one board. */
export function useLocalIdentity(): LocalIdentity {
  return useMemo(createLocalIdentity, []);
}
