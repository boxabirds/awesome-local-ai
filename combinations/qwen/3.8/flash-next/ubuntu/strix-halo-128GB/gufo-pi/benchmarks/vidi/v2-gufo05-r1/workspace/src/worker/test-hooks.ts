/**
 * Two endpoints that exist only so a test can break a board on purpose.
 *
 * Story 4's promise is about a board that failed to load, and the only honest way to
 * test it is to make one fail. The endpoints are compiled into the Worker but dead
 * unless it runs with `TEST_HOOKS=1` (`wrangler.jsonc` carries it commented out, and
 * the E2E harness passes it to the dev server it starts): without it,
 * `src/worker/index.ts` does not route the path and the room refuses it again.
 *
 * What they do is deliberately narrow: damage the *stored* snapshot so the next
 * connection reads a board it cannot decode, and undo that damage. Neither touches a
 * board's updates, and neither is reachable from the app — the path is
 * `/__test/boards/...`, which no client of the product asks for.
 *
 * These functions reach past `BoardStore` to the SQL underneath it on purpose. The
 * store's API is about boards — append, load, compact — and "replace a row with bytes
 * nothing can read" is not a thing a board does, so it does not belong on it. The
 * tables named here are the store's, and `test_snapshot_backup` is the one table this
 * file adds for itself: the bytes it is about to destroy, kept until they are asked
 * for back.
 */

/** Where the bytes of the damaged chunk wait, in a table only this file creates. */
const BACKUP_TABLE = 'test_snapshot_backup';

/**
 * An update whose type is neither 0 nor 1, and long enough that the decoder runs out
 * of input before it could mistake the bytes for something valid. Whatever followed
 * these in the snapshot is irrelevant: `Y.applyUpdate` refuses them at the first read,
 * which is the failure the room is meant to report rather than serve.
 */
const DAMAGE = "X'ffffffffff7f'";

export type TestHookAction = 'corrupt-snapshot' | 'repair-snapshot';

export interface TestHook {
  board: string;
  action: TestHookAction;
}

export function testHooksEnabled(env: { TEST_HOOKS?: string }): boolean {
  return env.TEST_HOOKS === '1';
}

/**
 * `/__test/boards/<boardId>/corrupt-snapshot` and `…/repair-snapshot`, or `null` for
 * any other path. The board id is read but not checked: the object handling the
 * request *is* the board, so the id can only ever name the one it already is.
 */
export function parseTestHook(pathname: string): TestHook | null {
  if (!pathname.startsWith('/__test/boards/')) return null;
  const rest = pathname.slice('/__test/boards/'.length);
  const separator = rest.lastIndexOf('/');
  if (separator <= 0 || separator === rest.length - 1) return null;
  const action = rest.slice(separator + 1);
  if (action !== 'corrupt-snapshot' && action !== 'repair-snapshot') return null;
  return { board: decodeURIComponent(rest.slice(0, separator)), action };
}

export interface SnapshotDamage {
  corrupted: boolean;
  /** Size of the chunk that was damaged, so a test can see it was a real one. */
  chunkBytes: number;
  reason?: string;
}

/**
 * Replace the first snapshot chunk with bytes Yjs will not read.
 *
 * The caller folds the log first, because the damage has to land on a snapshot: a
 * board nobody has compacted has nothing but an update log, and damaging *that* would
 * exercise the quarantine path instead of the one this is for.
 *
 * `INSERT OR IGNORE` keeps the *first* healthy copy of the bytes, so damaging a board
 * twice in a row still repairs to something readable.
 */
export function corruptSnapshot(storage: DurableObjectStorage): SnapshotDamage {
  const sql = storage.sql;
  const rows = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray() as {
    data: unknown;
  }[];
  const original = rows[0]?.data;
  if (original === undefined) return { corrupted: false, chunkBytes: 0, reason: 'no snapshot' };
  const bytes = toBytes(original);
  sql.exec(`CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`);
  sql.exec(
    `INSERT OR IGNORE INTO ${BACKUP_TABLE} (idx, data) VALUES (0, ?)`,
    bytes.slice().buffer,
  );
  sql.exec(`UPDATE snapshot_chunks SET data = ${DAMAGE} WHERE idx = 0`);
  return { corrupted: true, chunkBytes: bytes.byteLength };
}

export interface SnapshotRepair {
  repaired: boolean;
  chunkBytes?: number;
  reason?: string;
}

/**
 * Put the saved bytes back. A snapshot that was never damaged says so rather than
 * reporting a repair it did not make.
 */
export function repairSnapshot(storage: DurableObjectStorage): SnapshotRepair {
  const sql = storage.sql;
  let saved: { data: unknown }[];
  try {
    saved = sql.exec(`SELECT data FROM ${BACKUP_TABLE} WHERE idx = 0`).toArray() as { data: unknown }[];
  } catch (error) {
    // The backup table is created by the damage, so never having damaged anything
    // looks like this rather than like an empty result.
    return { repaired: false, reason: `no damaged snapshot (${describe(error)})` };
  }
  const bytes = saved[0]?.data;
  if (bytes === undefined) return { repaired: false, reason: 'no damaged snapshot' };
  const original = toBytes(bytes);
  sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original.slice().buffer);
  sql.exec(`DELETE FROM ${BACKUP_TABLE} WHERE idx = 0`);
  return { repaired: true, chunkBytes: original.byteLength };
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`SQLite returned a value that is not bytes: ${Object.prototype.toString.call(value)}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
