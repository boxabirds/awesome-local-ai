// Who this tab is, for the `createdBy` field an object records (story 9).
//
// Story 6 (identity: display name, colour, initials) is not built yet, so there is no
// `useIdentity()` to ask. Yjs already gives every tab a unique, stable id for exactly
// one purpose — the same one — and it is what syncs, so a text object created now is
// owned by whoever created it and story 6 can render that id as a name without any
// change to the document. When story 6 lands it replaces this one function; nothing
// else reads `createdBy`.

import type * as Y from 'yjs';

/** This tab's id, as stored in an object's `createdBy`. */
export function author(doc: Y.Doc): string {
  return String(doc.clientID);
}
