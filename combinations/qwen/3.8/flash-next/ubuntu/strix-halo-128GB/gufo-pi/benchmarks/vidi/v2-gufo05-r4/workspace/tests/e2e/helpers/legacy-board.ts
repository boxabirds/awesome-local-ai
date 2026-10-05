/**
 * A board as story 2 would have left it.
 *
 * Story 5's `share.legacy_board` needs a board from before boards had a beginning: updates with
 * no created_at, and a document that does not know its own id. Nothing in the product makes one
 * of those any more, so the fixture makes the *inputs* rather than the storage rows — real Yjs
 * updates from a `Y.Doc` built through the real `createSticky` mutator — and a test-only Worker
 * route (`/__test/seed-legacy`, behind `TEST_HOOKS=1`) writes them the way an old board's socket
 * would have.
 *
 * The bytes are ordinary `Uint8Array`s on purpose: they are what the wire carried, and the
 * migration has to cope with them without a hint.
 */

import * as Y from 'yjs';
import { newBoardId } from '../../../src/shared/board-id';
import { createSticky, getStickyText, initDoc } from '../../../src/shared/board-model';

export const LEGACY_BOARD_TEXT = 'written before boards had a beginning';

/** A board from before there were boards, and the updates that make it. */
export function legacyBoardFixture(text = LEGACY_BOARD_TEXT): {
  id: string;
  legacyDoc: Y.Doc;
  updates: Uint8Array[];
} {
  const legacyDoc = new Y.Doc();
  initDoc(legacyDoc);
  // No board id in the document: the id was a client's idea, not something the board kept.
  const noteId = createSticky(legacyDoc, { x: 120, y: 80 }, 'yellow');
  getStickyText(legacyDoc, noteId)?.insert(0, text);
  if (getStickyText(legacyDoc, noteId)?.toString() !== text) {
    throw new Error('the legacy fixture did not end up holding its text');
  }
  return { id: newBoardId(), legacyDoc, updates: [Y.encodeStateAsUpdate(legacyDoc)] };
}
