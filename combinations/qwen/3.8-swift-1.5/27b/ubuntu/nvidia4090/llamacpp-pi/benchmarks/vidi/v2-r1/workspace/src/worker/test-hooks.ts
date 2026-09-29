import * as Y from 'yjs';
import { initDoc, createSticky } from '../shared/board-model';
import type { Env } from './index';

/**
 * Test-only hook (gated behind TEST_HOOKS=1 in the worker): seed a legacy
 * board — one that has saved Yjs `updates` rows but no `storage_meta.created_at`,
 * i.e. a board that existed before the share feature shipped
 * (share.legacy_boards).
 *
 * POST /__test/boards/:id/seed-legacy
 */
export async function handleSeedLegacyBoard(_req: Request, env: Env, boardId: string): Promise<Response> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);

  // Build a real Yjs update with one note.
  const doc = new Y.Doc();
  initDoc(doc);
  createSticky(doc, { x: 120, y: 90 }, 'blue');
  const updateBytes = Array.from(Y.encodeStateAsUpdate(doc));

  // Write the update row directly, without created_at and without the rest of
  // the current schema (no storage_meta row for created_at).
  const seedReq = new Request('http://internal/__test/storage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'execute',
      data: {
        query:
          "CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL); " +
          'INSERT INTO updates (data, bytes) VALUES (?, ?)',
        params: [updateBytes, updateBytes.length],
      },
    }),
  });
  const seedResp = await stub.fetch(seedReq);
  const seedData = await seedResp.json();

  if (!seedData.ok) {
    return Response.json({ error: seedData.error ?? 'seed_failed' }, { status: 500 });
  }

  // The DO's live doc was loaded (empty) when the seed's get() first
  // instantiated it. Re-load it so the newly written rows are live for the
  // client that opens the board next.
  await stub.reload();

  return Response.json({ ok: true, id: boardId });
}
