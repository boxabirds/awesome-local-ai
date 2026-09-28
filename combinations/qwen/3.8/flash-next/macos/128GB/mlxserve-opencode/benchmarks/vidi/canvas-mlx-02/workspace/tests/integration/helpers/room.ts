// Reaching one board's own Durable Object the way the Worker does - same
// namespace, same `idFromName` mapping - and reading the storage behind it.
//
// `sql()` goes through the room's TEST_HOOKS-gated `/__test/boards/:id/sql` route
// (unlocked by wrangler.test.jsonc), which runs the statement against the same
// SQLite file the room itself reads. Bindings are passed separately rather than
// interpolated, so an assertion about a meta key is an assertion about that key.
import { env, runInDurableObject } from 'cloudflare:test';
import type { BoardRoom } from '../../../src/worker/index.ts';
import { OWN_TABLES, type BoardStore } from '../../../src/worker/board-store.ts';

const NAMESPACE = (env as unknown as { BOARD_ROOM: DurableObjectNamespace<BoardRoom> })
  .BOARD_ROOM;

/** The room object for a code, addressed exactly as the Worker addresses it. */
export function roomStub(boardId: string): DurableObjectStub<BoardRoom> {
  return NAMESPACE.get(NAMESPACE.idFromName(boardId));
}

/** What the board's own object says about existing. This is the Worker's RPC. */
export function roomExists(boardId: string): Promise<boolean> {
  return roomStub(boardId).exists();
}

/** The creation RPC itself - the same call `POST /api/boards` makes. */
export function roomInitialize(boardId: string): Promise<'created' | 'exists'> {
  return roomStub(boardId).initialize();
}

/** The object id a code maps to, as a string, for comparison. */
export function roomIdFor(boardId: string): string {
  return String(NAMESPACE.idFromName(boardId));
}

export type SqlValue = string | number | null;

/**
 * One statement against that board's own storage, run inside the board's own
 * Durable Object (`runInDurableObject`), which is how this suite reads a room's
 * internals elsewhere. Doing it from inside the object rather than through an HTTP
 * route keeps the production worker - the one built from wrangler.jsonc, where
 * TEST_HOOKS is not set - the thing under test, and the statement still runs
 * against the same SQLite file the board itself reads. Bindings go in separately
 * rather than interpolated, so an assertion about a meta key is an assertion about
 * that key.
 */
export async function sql<T = Record<string, unknown>>(
  boardId: string,
  statement: string,
  bindings: SqlValue[] = [],
): Promise<T[]> {
  return runInDurableObject(roomStub(boardId), (room) =>
    (room as unknown as { store: BoardStore }).store.testQuery(statement, bindings) as T[],
  );
}

/**
 * Content written into a board from inside its own object, the way the durability
 * suite writes it: one Yjs update, applied and appended, then compacted. This is
 * how a test arranges a board that has content and no creation stamp, which is
 * what a board made before story 5 looks like.
 */
export async function seedFromInside(boardId: string, update: Uint8Array): Promise<void> {
  await runInDurableObject(roomStub(boardId), (room) => room.testSeed(update));
}

/**
 * Which of the store's own tables exist for this board, in the store's own order.
 * Empty means the board was never made. SQLite's own bookkeeping tables (like
 * `sqlite_sequence`, which AUTOINCREMENT creates) are not the store's tables and
 * saying so keeps this assertion about the board rather than about SQLite.
 */
export async function tableNames(boardId: string): Promise<string[]> {
  const placeholders = OWN_TABLES.map(() => '?').join(', ');
  const rows = await sql<{ name: string }>(
    boardId,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders}) ORDER BY name`,
    [...OWN_TABLES],
  );
  return rows.map((row) => row.name);
}

/** The keys in `storage_meta`, sorted. */
export async function metaKeys(boardId: string): Promise<string[]> {
  if (!(await tableNames(boardId)).includes('storage_meta')) return [];
  const rows = await sql<{ key: string }>(boardId, `SELECT key FROM storage_meta ORDER BY key`);
  return rows.map((row) => row.key);
}

/** One `storage_meta` value, or null when the key is not there. */
export async function metaValue(boardId: string, key: string): Promise<string | null> {
  if (!(await tableNames(boardId)).includes('storage_meta')) return null;
  const rows = await sql<{ value: string }>(
    boardId,
    `SELECT value FROM storage_meta WHERE key = ?`,
    [key],
  );
  return rows.length === 0 ? null : rows[0].value;
}

/** Rows in one of the board's content tables; only the real names are allowed. */
export async function rowCount(
  boardId: string,
  table: 'updates' | 'snapshot_chunks' | 'quarantined_updates',
): Promise<number> {
  if (!(await tableNames(boardId)).includes(table)) return 0;
  const rows = await sql<{ n: number }>(boardId, `SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}
