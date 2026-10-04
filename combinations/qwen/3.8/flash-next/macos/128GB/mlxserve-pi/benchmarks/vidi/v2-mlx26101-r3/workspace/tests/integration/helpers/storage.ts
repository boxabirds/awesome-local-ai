import { env, runInDurableObject } from 'cloudflare:test';
import { BoardStore, NO_FAULTS, type StoreFaults } from '../../../src/worker/board-store';
import type { BoardRoom } from '../../../src/worker/board-room';
import type { Env } from '../../../src/worker/index';
import { newBoardId } from '../../../src/shared/board-id';

/**
 * Getting at one board's real storage.
 *
 * The persistence tests have to look inside the database the room itself writes to, and a
 * Durable Object's SQLite storage can only be reached from inside the object. These helpers run
 * a statement there and hand the plain values back out; `runInDurableObject` is also how a test
 * builds a `BoardStore` over the same storage the room uses, which is what makes "written by the
 * room, read by the test" one database rather than a copy of it.
 */

/** The Worker's own `BOARD_ROOM` namespace, as the real one. */
export const BOARD_ROOM: DurableObjectNamespace<BoardRoom> = (
  env as unknown as Env
).BOARD_ROOM;

/** A board id nobody has used before; the tests never hand-write ids. */
export function boardId(): string {
  return newBoardId();
}

/** One board's Durable Object, whether or not it exists yet. */
export function boardStub(name = boardId()): DurableObjectStub<BoardRoom> {
  return BOARD_ROOM.get(BOARD_ROOM.idFromName(name));
}

/** The id a board's Durable Object is stored under, as the string a fault is armed for. */
export function boardStubId(name: string): string {
  return BOARD_ROOM.idFromName(name).toString();
}

/**
 * Construct the room the way a connection does, and wait for it to have read its board.
 *
 * A plain HTTP request is refused with 426 - there is no route to a board over anything but a
 * socket - but the object behind it is constructed first, which is when the room creates its
 * tables and reads what is already stored in them.
 */
export async function openRoom(stub: DurableObjectStub<BoardRoom>): Promise<number> {
  const response = await stub.fetch(new Request('http://board-room/'));
  return response.status;
}

/** Run a statement inside the board's own storage and give the rows back as plain values. */
export async function selectRows(
  stub: DurableObjectStub<BoardRoom>,
  query: string,
  ...bindings: unknown[]
): Promise<Record<string, unknown>[]> {
  return runInDurableObject(stub, (_room, state) => {
    const rows: Record<string, unknown>[] = [];
    for (const row of state.storage.sql.exec(query, ...bindings)) {
      rows.push(row);
    }
    return rows;
  });
}

/** How many rows a table holds. */
export async function countRows(
  stub: DurableObjectStub<BoardRoom>,
  table: 'updates' | 'snapshot_chunks' | 'quarantined_updates' | 'storage_meta',
): Promise<number> {
  const [row] = await selectRows(stub, `SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row?.['count'] ?? 0);
}

/** The first number a statement gives back. */
export async function selectNumber(
  stub: DurableObjectStub<BoardRoom>,
  query: string,
  ...bindings: unknown[]
): Promise<number> {
  const [row] = await selectRows(stub, query, ...bindings);
  return Number(row === undefined ? 0 : (Object.values(row)[0] ?? 0));
}

/** The first text value a statement gives back. */
export async function selectText(
  stub: DurableObjectStub<BoardRoom>,
  query: string,
  ...bindings: unknown[]
): Promise<string | null> {
  const [row] = await selectRows(stub, query, ...bindings);
  const first = row === undefined ? undefined : Object.values(row)[0];
  return typeof first === 'string' ? first : null;
}

/**
 * Run work with a `BoardStore` over the board's real storage.
 *
 * The tables are created first, because these tests are about rows rather than about who made
 * the tables; `migrate` is `CREATE TABLE IF NOT EXISTS`, so a board the room has already opened
 * is left exactly as it was. What the work returns has to be plain data - numbers, strings,
 * arrays of them - because that is what comes back out of the Durable Object; the test's own
 * document stays inside it, which is why the work takes a store and a document and reports what
 * it saw. `faults` is how a test makes one of the store's own statements fail; see
 * `src/worker/board-store.ts`. `notices` collects what the store told the room about storage -
 * a damaged row, a compaction that was rolled back - which is how a test checks that damage was
 * reported instead of swallowed.
 */
export async function insideBoard<T>(
  stub: DurableObjectStub<BoardRoom>,
  work: (store: BoardStore, storage: DurableObjectStorage, notices: string[]) => T,
  options: { faults?: StoreFaults } = {},
): Promise<T> {
  return runInDurableObject(stub, (_room, state) => {
    const notices: string[] = [];
    const store = new BoardStore(state.storage, {
      faults: options.faults ?? NO_FAULTS,
      note: (message: string) => {
        notices.push(message);
      },
    });
    store.migrate();
    return work(store, state.storage, notices);
  });
}
