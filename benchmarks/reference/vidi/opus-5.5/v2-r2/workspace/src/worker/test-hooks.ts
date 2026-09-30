// Test-only routes for e2e tests (TC-24): force compaction, corrupt and repair a
// board's saved snapshot. Reachable only when `env.TEST_HOOKS === '1'`, which is
// set by the e2e `wrangler dev --var TEST_HOOKS:1` and never in wrangler.jsonc.
import type * as Y from 'yjs';
import { isValidBoardId } from '../shared/board-id';
import type { BoardStore } from './board-store';
import type { Env } from './index';

const WORKER_PATH = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|repair)$/;
const ROOM_PATH = /^\/__test\/boards\/[^/]+\/(compact|corrupt-snapshot|repair)$/;

/** Bytes cut from the end of snapshot chunk 0 to make it unreadable. */
const CORRUPT_TRUNCATE_BYTES = 10;

export interface TestHookRoom {
  readonly storage: DurableObjectStorage;
  readonly store: BoardStore;
  loadedDoc(): Y.Doc | null;
  unload(): void;
}

export function isTestHookPath(pathname: string): boolean {
  return ROOM_PATH.test(pathname);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Worker side: forwards `POST /__test/boards/:id/<action>` to the board's room, or returns null. */
export function routeTestHook(request: Request, env: Env): Promise<Response> | null {
  if (env.TEST_HOOKS !== '1') return null;
  const match = WORKER_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== 'POST') return Promise.resolve(json({ error: 'POST only' }, 405));
  const boardId = match[1] ?? '';
  if (!isValidBoardId(boardId)) return Promise.resolve(json({ error: 'invalid board id' }, 400));
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
}

/** Room side: runs the action against this room's storage. */
export function handleRoomTestHook(pathname: string, room: TestHookRoom): Response {
  const action = ROOM_PATH.exec(pathname)?.[1];
  const sql = room.storage.sql;
  switch (action) {
    case 'compact': {
      const doc = room.loadedDoc();
      if (!doc) return json({ hook: action, ok: false, error: 'board not loaded' }, 409);
      return json({ hook: action, ok: room.store.compact(doc) });
    }
    case 'corrupt-snapshot': {
      const chunk = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0];
      if (!chunk) return json({ hook: action, ok: false, error: 'no snapshot' }, 409);
      sql.exec('CREATE TABLE IF NOT EXISTS test_saved_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
      sql.exec('INSERT OR REPLACE INTO test_saved_chunks (idx, data) VALUES (0, ?)', chunk.data);
      const damaged = chunk.data.slice(0, Math.max(0, chunk.data.byteLength - CORRUPT_TRUNCATE_BYTES));
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged);
      // Forget the in-memory board, as a restart would, so the next connection loads the damaged state.
      room.unload();
      return json({ hook: action, ok: true });
    }
    case 'repair': {
      sql.exec('CREATE TABLE IF NOT EXISTS test_saved_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
      const saved = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM test_saved_chunks WHERE idx = 0').toArray()[0];
      if (!saved) return json({ hook: action, ok: false, error: 'nothing to repair' }, 409);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', saved.data);
      sql.exec('DELETE FROM test_saved_chunks');
      return json({ hook: action, ok: true });
    }
    default:
      return json({ error: 'unknown hook' }, 404);
  }
}
