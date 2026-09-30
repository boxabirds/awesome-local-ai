// Test-only routes (e2e TC-24), served only when env.TEST_HOOKS === '1'. That
// variable is set by the e2e `wrangler dev` command line and never in wrangler.jsonc,
// so production requests to these paths fall through to the static client.
//
//   POST /__test/boards/:id/compact           snapshot the board now
//   POST /__test/boards/:id/corrupt-snapshot  save chunk 0, overwrite it, reload the room
//   POST /__test/boards/:id/repair            restore the saved chunk 0 (the room reloads on its own retry)
import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

export const TEST_HOOK_PATH = '/__test/';
const ROUTE = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|repair)$/;

/** Worker side: forwards a hook request to the board's room. */
export async function routeTestHook(req: Request, env: Env): Promise<Response> {
  const match = ROUTE.exec(new URL(req.url).pathname);
  if (!match || req.method !== 'POST' || !isValidBoardId(match[1])) return new Response('Not Found', { status: 404 });
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(match[1])).fetch(req);
}

export interface RoomTestControls {
  compact(): boolean;
  /** Closes every socket and reloads the doc from storage; returns the room state. */
  reload(): string;
}

/** Room side: runs a hook against the room's own storage. */
export function runRoomTestHook(req: Request, storage: DurableObjectStorage, room: RoomTestControls): Response {
  const action = ROUTE.exec(new URL(req.url).pathname)?.[2];
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS test_saved_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
  switch (action) {
    case 'compact':
      return Response.json({ compacted: room.compact() });
    case 'corrupt-snapshot': {
      const chunk = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray()[0];
      if (!chunk) return Response.json({ error: 'no snapshot' }, { status: 409 });
      sql.exec('INSERT OR REPLACE INTO test_saved_chunks (idx, data) VALUES (0, ?)', chunk.data);
      const garbage = new Uint8Array(chunk.data.byteLength);
      crypto.getRandomValues(garbage.subarray(0, Math.min(garbage.length, 65536)));
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', garbage.buffer);
      return Response.json({ state: room.reload() });
    }
    case 'repair': {
      const saved = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM test_saved_chunks WHERE idx = 0').toArray()[0];
      if (!saved) return Response.json({ error: 'nothing to repair' }, { status: 409 });
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', saved.data);
      sql.exec('DELETE FROM test_saved_chunks');
      return Response.json({ repaired: true });
    }
    default:
      return new Response('Not Found', { status: 404 });
  }
}
