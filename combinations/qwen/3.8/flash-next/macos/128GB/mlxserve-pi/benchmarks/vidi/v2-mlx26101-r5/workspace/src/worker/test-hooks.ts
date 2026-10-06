/**
 * Storage hooks for the tests that need a board to be broken on purpose.
 *
 * Story 4's promise is about what happens when storage misbehaves, and a test cannot wait
 * for a disk to fail. These two endpoints damage and repair one board's snapshot so the
 * honest-failure path (a red "This board couldn't be loaded. Retrying…", no editing, a board
 * that comes back by itself) can be driven in a real browser.
 *
 * They exist only when the deployment says so: `env.TEST_HOOKS === '1'`, which is set by
 * nothing in the production config and by nothing in `wrangler.jsonc`. A request to
 * `/__test/...` against a normal build is not routed here at all — it falls through to the
 * static assets, which is the check the e2e suite makes.
 */

import { isValidBoardId } from '../shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED } from '../shared/protocol';
import type { Env } from './index';

/** The variable that turns these routes on, and the only value that turns them on. */
export const TEST_HOOKS_ENV = 'TEST_HOOKS';
export const TEST_HOOKS_ON = '1';

/** Where the hooks live in the URL space: `/__test/boards/<board id>/<action>`. */
export const TEST_HOOK_PREFIX = '/__test/boards/';

/** The path a hook request is forwarded to the board's own object as. */
export const ROOM_HOOK_PREFIX = '/__test/';

/** The endpoints that exist. Anything else is a 404, which is what a normal build gives too. */
const ROOM_HOOK_ACTIONS: readonly RoomHookAction[] = [
  'compact',
  'hibernate',
  'corrupt-snapshot',
  'repair',
];

/**
 * What a board's object can be asked to do to itself. `corrupt-snapshot` and `repair` are about
 * the bytes in its storage; `compact` and `hibernate` are about what it is holding in memory,
 * and are answered by the object itself before they get here.
 */
export type RoomHookAction = 'compact' | 'hibernate' | 'corrupt-snapshot' | 'repair';

/** Where the original bytes of a damaged chunk are kept while it is damaged. */
const SAVED_CHUNKS_TABLE = '__test_saved_chunks';

/** True when this deployment has the hooks switched on. */
export function testHooksEnabled(env: Pick<Env, 'TEST_HOOKS'>): boolean {
  return env.TEST_HOOKS === TEST_HOOKS_ON;
}

/** A machine-readable answer for a hook request that could not be honoured. */
function hookError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-vidi6-error': code },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Routes `/__test/boards/:boardId/<action>` to that board's Durable Object, because the
 * damage has to be done in that board's storage and the object holding it in memory has to
 * be told about it. Returns null for anything that is not an enabled hook request, which is
 * how the caller stays out of the way of a normal build.
 */
export async function routeTestHook(request: Request, env: Env): Promise<Response | null> {
  if (!testHooksEnabled(env)) return null;
  const path = new URL(request.url).pathname;
  if (!path.startsWith(TEST_HOOK_PREFIX)) return null;

  const rest = path.slice(TEST_HOOK_PREFIX.length);
  const slash = rest.indexOf('/');
  const boardId = slash === -1 ? rest : rest.slice(0, slash);
  const action = slash === -1 ? '' : rest.slice(slash + 1);
  if (!isValidBoardId(boardId)) {
    return hookError(400, 'invalid_board_id', 'A board id is 22 characters of [A-Za-z0-9_-].');
  }
  if (!ROOM_HOOK_ACTIONS.includes(action as RoomHookAction)) {
    return hookError(404, 'not_found', `No such endpoint: ${path}`);
  }
  if (request.method !== 'POST') {
    return hookError(405, 'method_not_allowed', 'Storage hooks are POSTed to.');
  }

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return stub.fetch(
    new Request(`https://board-room.internal${ROOM_HOOK_PREFIX}${action}`, { method: 'POST' }),
  );
}

/**
 * Damages (or repairs) this board's snapshot, in this board's own database.
 *
 * `evict` is what the room does with itself afterwards: forget the document it was serving
 * and tell everybody connected. A snapshot corrupted while the room still holds the board
 * would change nothing a client could see, so the room is put where a restart would have put
 * it.
 */
export function runRoomTestHook(
  storage: DurableObjectStorage,
  action: string,
  evict: () => void,
): Response {
  if (action === 'corrupt-snapshot') return corruptSnapshot(storage, evict);
  if (action === 'repair') return repairSnapshot(storage);
  return hookError(404, 'not_found', `No such hook: ${action}`);
}

/** What was done to the board. */
interface DamageResult {
  ok: boolean;
  chunks?: number;
  bytes?: number;
  reason?: string;
}

function corruptSnapshot(storage: DurableObjectStorage, evict: () => void): Response {
  let result: DamageResult = { ok: false, reason: 'no-snapshot' };
  try {
    storage.transactionSync(() => {
      storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${SAVED_CHUNKS_TABLE} (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
      );
      const chunks = [...storage.sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx')];
      if (chunks.length === 0) return;
      const first = chunks[0];
      if (first === undefined) return;
      const original = bytesOf(first.data);
      storage.sql.exec(
        `INSERT OR REPLACE INTO ${SAVED_CHUNKS_TABLE} (idx, data) VALUES (?1, ?2)`,
        Number(first.idx),
        asBlob(original),
      );
      // The same number of bytes, none of them readable: 0xFF is a `varUint` continuation
      // that runs off the end of any number, which is exactly the "this row is nonsense" that
      // a corrupted block produces. The chunk keeps its length, so nothing about the row's
      // shape gives the game away.
      storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ?1 WHERE idx = ?2',
        asBlob(new Uint8Array(original.length).fill(0xff)),
        Number(first.idx),
      );
      result = { ok: true, chunks: chunks.length, bytes: original.length };
    });
  } catch (error) {
    return hookError(500, 'corrupt_failed', String(error));
  }

  const damage = result;
  if (!damage.ok) {
    // Nothing to damage: the board is still only a log, so nothing would ever fail to load.
    // The test compacts the board first; getting this back means it forgot to.
    return hookError(409, 'no_snapshot', 'This board has no snapshot to damage yet.');
  }
  evict();
  return json({ ...damage, closedWith: CLOSE_BOARD_LOAD_FAILED });
}

function repairSnapshot(storage: DurableObjectStorage): Response {
  try {
    const saved = [
      ...storage.sql.exec(`SELECT idx, data FROM ${SAVED_CHUNKS_TABLE} ORDER BY idx`),
    ];
    if (saved.length === 0) return json({ ok: true, repaired: 0 });
    storage.transactionSync(() => {
      for (const row of saved) {
        storage.sql.exec(
          'UPDATE snapshot_chunks SET data = ?1 WHERE idx = ?2',
          asBlob(bytesOf(row.data)),
          Number(row.idx),
        );
        storage.sql.exec(`DELETE FROM ${SAVED_CHUNKS_TABLE} WHERE idx = ?1`, Number(row.idx));
      }
    });
    return json({ ok: true, repaired: saved.length });
  } catch (error) {
    return hookError(500, 'repair_failed', String(error));
  }
}

/** A BLOB column as bytes. */
function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('expected a BLOB column');
}

/** A BLOB parameter: an ArrayBuffer exactly as long as the bytes. */
function asBlob(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
