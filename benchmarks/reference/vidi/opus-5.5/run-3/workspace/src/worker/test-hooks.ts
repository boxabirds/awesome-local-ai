// Test-only routes for the e2e suite, compiled in but reachable only when `env.TEST_HOOKS === '1'` (set by the
// e2e wrangler command line, never in wrangler.jsonc). Without it these paths fall through to the static client.
//
//   POST /__test/boards/:id/seed               body: a Yjs update; applied like a client update, then compacted
//   POST /__test/boards/:id/seed-legacy        body: a Yjs update; stored as log rows without created_at, as a
//                                              board saved before board creation existed (story 5 TC-31)
//   POST /__test/boards/:id/compact            fold the log into the snapshot
//   POST /__test/boards/:id/corrupt-snapshot   save snapshot chunk 0 aside, overwrite it with garbage, reload
//   POST /__test/boards/:id/repair             put the saved chunk 0 back
import { isValidBoardId } from '../shared/board-id';
import type { BoardStorage } from './board-store';
import type { Env } from './index';

export type TestHookAction = 'seed' | 'seed-legacy' | 'compact' | 'corrupt-snapshot' | 'repair';

const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(seed|seed-legacy|compact|corrupt-snapshot|repair)$/;

/** The hook response, or null when the request is not a (enabled) test hook. */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;
  const match = HOOK_PATH.exec(new URL(req.url).pathname);
  if (!match) return null;
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const [, boardId, action] = match;
  if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
  const body = action === 'seed' || action === 'seed-legacy' ? await req.arrayBuffer() : undefined;
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const ok = await stub.testHook(action as TestHookAction, body);
  return new Response(ok ? 'ok' : 'not applied', { status: ok ? 200 : 409 });
}

function ensureSavedTable(storage: BoardStorage): void {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS test_saved_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
}

/** Saves snapshot chunk 0 aside and overwrites it with bytes Yjs cannot read. False if there is no snapshot. */
export function corruptSnapshot(storage: BoardStorage): boolean {
  const row = storage.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0];
  if (!row) return false;
  ensureSavedTable(storage);
  const original = new Uint8Array(row.data as ArrayBuffer);
  storage.transactionSync(() => {
    storage.sql.exec('INSERT OR IGNORE INTO test_saved_chunks (idx, data) VALUES (0, ?)', original);
    storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original.slice(0, Math.max(1, original.length - 10)));
  });
  return true;
}

/** Restores the chunk saved by `corruptSnapshot`. False if nothing was saved. */
export function repairSnapshot(storage: BoardStorage): boolean {
  ensureSavedTable(storage);
  const row = storage.sql.exec('SELECT data FROM test_saved_chunks WHERE idx = 0').toArray()[0];
  if (!row) return false;
  storage.transactionSync(() => {
    storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', row.data);
    storage.sql.exec('DELETE FROM test_saved_chunks WHERE idx = 0');
  });
  return true;
}
