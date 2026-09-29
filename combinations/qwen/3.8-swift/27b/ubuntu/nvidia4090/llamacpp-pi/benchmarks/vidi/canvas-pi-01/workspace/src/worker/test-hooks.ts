// Test-only board seeding (story 4 test hooks + story 5 TC-31).
//
// Wired from the /__test routes in index.ts only when env.TEST_HOOKS === '1'
// (the e2e dev server writes it to .dev.vars). The production build never
// sets that, so these paths are unreachable there.

import * as Y from 'yjs';
import { createSticky } from '../shared/board-model';
import { BoardStore } from './board-store';

/**
 * Seed `notes` sticky notes into a board's storage as a legacy board
 * (share.legacy_boards): real Yjs update rows with the story 4 schema but no
 * created_at, exactly as boards saved before story 5 look. Returns the number
 * of seeded notes.
 */
export function seedLegacyUpdates(store: BoardStore, notes: number): number {
  store.migrate();
  // A legacy board predates created_at: make sure it is absent.
  store.storage.sql.exec("DELETE FROM storage_meta WHERE key = 'created_at'");
  const doc = new Y.Doc();
  for (let i = 0; i < notes; i++) {
    createSticky(doc, { x: i * 220, y: 0 });
  }
  store.append(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return notes;
}
