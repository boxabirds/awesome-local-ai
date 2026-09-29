// Test-only routes that damage and repair a board's saved snapshot (e2e TC-24) and seed a
// board saved before boards were created explicitly (story 5 e2e TC-31). The Worker
// routes them only when env.TEST_HOOKS === '1', which only the e2e `wrangler dev` sets
// (`--var TEST_HOOKS:1`); the production config never does.
import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

export type TestHookAction = 'corrupt-snapshot' | 'repair';

const TEST_ROUTE = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair|seed-legacy)$/;

export function testHooksEnabled(env: Env): boolean {
  return env.TEST_HOOKS === '1';
}

/** Handles a test hook request, or returns null when `url` is not a test route or hooks are off. */
export async function handleTestHook(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (!testHooksEnabled(env)) return null;
  const match = TEST_ROUTE.exec(url.pathname);
  if (!match) return null;
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isValidBoardId(match[1])) return new Response('Invalid board id', { status: 400 });
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(match[1]));
  // seed-legacy: the body is one Yjs update, stored as update rows without `created_at`.
  const ok =
    match[2] === 'seed-legacy'
      ? await room.seedLegacy(new Uint8Array(await req.arrayBuffer()))
      : await room.testHook(match[2] as TestHookAction);
  return new Response(ok ? 'ok' : 'nothing to do', { status: ok ? 200 : 409 });
}

const SAVED_CHUNK_TABLE =
  'CREATE TABLE IF NOT EXISTS test_saved_chunk (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)';

/**
 * Saves snapshot chunk 0 and overwrites it with bytes Yjs cannot read (0xFF never ends a
 * varint). Expects a snapshot to exist (the room compacts first). False without one.
 */
export function corruptSnapshotChunk(sql: SqlStorage): boolean {
  const rows = sql
    .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0')
    .toArray();
  if (!rows.length) return false;
  sql.exec(SAVED_CHUNK_TABLE);
  sql.exec('INSERT OR IGNORE INTO test_saved_chunk (idx, data) VALUES (0, ?)', rows[0].data);
  const damaged = new Uint8Array(rows[0].data.byteLength).fill(0xff);
  sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', damaged);
  return true;
}

/** Restores the chunk saved by `corruptSnapshotChunk`. False when nothing was saved. */
export function repairSnapshotChunk(sql: SqlStorage): boolean {
  sql.exec(SAVED_CHUNK_TABLE);
  const rows = sql
    .exec<{ data: ArrayBuffer }>('SELECT data FROM test_saved_chunk WHERE idx = 0')
    .toArray();
  if (!rows.length) return false;
  sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', rows[0].data);
  sql.exec('DELETE FROM test_saved_chunk');
  return true;
}
