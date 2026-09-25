/**
 * Test-only storage hooks for the e2e "Broken board" workflow (design Fixtures, TC-24).
 * Routes exist only when `env.TEST_HOOKS === '1'`, which is set solely by the e2e
 * `wrangler dev --var TEST_HOOKS:1` command line, never in `wrangler.jsonc`:
 *
 *   POST /__test/boards/:id/compact           fold the update log into a snapshot
 *   POST /__test/boards/:id/corrupt-snapshot  save chunk 0 aside, overwrite it, reload the room
 *   POST /__test/boards/:id/repair            restore the saved chunk 0
 *   POST /__test/boards/:id/seed-legacy       body = one Yjs update, stored as a board saved
 *                                             before story 5 (log rows, no created_at; TC-31)
 *
 * Without the variable these paths fall through to the static client like any other URL.
 */
import { isValidBoardId } from '../shared/board-id';
import { BoardStore } from './board-store';
import type { Env } from './index';

export class TestHookError extends Error {}

const ROUTE = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|repair|seed-legacy)$/;
const BACKUP_TABLE = 'CREATE TABLE IF NOT EXISTS test_hook_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)';
const OK = 200;
const BAD_REQUEST = 400;
const CONFLICT = 409;
/** Bytes that are never a readable Yjs update (every varint continues past the end). */
const DAMAGED_BYTE = 0xff;

export function corruptSnapshot(storage: DurableObjectStorage): void {
  const chunk = storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0];
  if (chunk === undefined) throw new TestHookError('board has no snapshot; compact it first');
  const original = new Uint8Array(chunk.data);
  storage.transactionSync(() => {
    storage.sql.exec(BACKUP_TABLE);
    storage.sql.exec('INSERT OR REPLACE INTO test_hook_backup (idx, data) VALUES (0, ?)', original);
    storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', new Uint8Array(original.length).fill(DAMAGED_BYTE));
  });
}

export function repairSnapshot(storage: DurableObjectStorage): void {
  storage.sql.exec(BACKUP_TABLE);
  const saved = storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM test_hook_backup WHERE idx = 0').toArray()[0];
  if (saved === undefined) throw new TestHookError('nothing to repair');
  storage.transactionSync(() => {
    storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', new Uint8Array(saved.data));
    storage.sql.exec('DELETE FROM test_hook_backup');
  });
}

/** Writes `update` as the only log row of a board that has no `created_at`. */
export function seedLegacyBoard(storage: DurableObjectStorage, update: Uint8Array): void {
  new BoardStore(storage).migrate();
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM storage_meta WHERE key = 'created_at'");
    storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
  });
}

/** Handles a test hook request, or returns null when hooks are disabled or the path is not a hook. */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1' || req.method !== 'POST') return null;
  const match = ROUTE.exec(new URL(req.url).pathname);
  if (match === null) return null;
  const [, boardId = '', action] = match;
  if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: BAD_REQUEST });
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  try {
    const result =
      action === 'compact'
        ? await room.testCompact()
        : action === 'corrupt-snapshot'
          ? await room.testCorruptSnapshot()
          : action === 'seed-legacy'
            ? await room.testSeedLegacy(new Uint8Array(await req.arrayBuffer()))
            : await room.testRepairSnapshot();
    return Response.json({ ok: true, result }, { status: OK });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: CONFLICT });
  }
}
