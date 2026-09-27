/**
 * Run `BoardStore` against the SQLite database of a real Durable Object, and
 * the raw SQL of that database.
 *
 * The only way to get a real `DurableObjectStorage` is to be inside the object,
 * so `runInDurableObject` is the door: the work happens in the object's context
 * and only plain values come back. Each store under test uses its own board id,
 * which for a SQLite-backed object means its own database file (design
 * "Storage layer").
 */
import { env, runInDurableObject } from 'cloudflare:test';

import { BoardStore } from '../../../src/worker/board-store';

let sequence = 0;

/**
 * A board id no other test uses, so each one gets a database of its own.
 *
 * It is also a *valid* board id — the worker accepts exactly 22 characters of
 * `[A-Za-z0-9_-]` and refuses anything else before a room is ever reached — so
 * a test can inspect the storage of a board and connect to it with the same id.
 * The label comes first, up to a point: reading a failure back from a database
 * should say which test wrote it.
 */
export function uniqueBoardId(label = 'store-test'): string {
  sequence += 1;
  const head = label.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 10);
  const random = crypto.randomUUID().replaceAll('-', '');
  return `${head}${String(sequence).padStart(2, '0')}${random}`.slice(0, 22);
}

function boardStub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/**
 * Work against one board's storage. The store is migrated first: every test
 * starts from a created board unless it asks about creation itself.
 */
export function withStore<T>(
  boardId: string,
  body: (args: { store: BoardStore; sql: SqlStorage; storage: DurableObjectStorage }) => T,
): Promise<T> {
  return runInDurableObject(boardStub(boardId), (room, state) => {
    void room;
    const store = new BoardStore(state.storage);
    store.migrate();
    return body({ store, sql: state.storage.sql, storage: state.storage });
  });
}

/** Read or corrupt one board's rows directly, without a store in the way. */
export function withSql<T>(boardId: string, body: (sql: SqlStorage) => T): Promise<T> {
  return runInDurableObject(boardStub(boardId), (room, state) => {
    void room;
    return body(state.storage.sql);
  });
}


/** One row of a single-column query, as a number. */
export function countRows(sql: SqlStorage, table: string): number {
  const row = sql.exec<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`).one();
  return row.total;
}

export function metaValue(sql: SqlStorage, key: string): string | undefined {
  const row = sql
    .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key)
    .toArray()[0];
  return row?.value;
}

/**
 * A `DurableObjectStorage` whose `sql.exec` runs the real statement and then
 * throws on a chosen query — the injection point for a compaction that dies
 * half way through (TC-11). Everything else, `transactionSync` included, is the
 * real storage, so the rollback under test is real too.
 *
 * Only reachable here, and only used to prove the rollback: the rows and the
 * transaction are the things under test, not the Durable Object around them.
 */
export function storageFailingAfter(
  storage: DurableObjectStorage,
  match: (query: string) => boolean,
): DurableObjectStorage {
  const sql = {
    exec(query: string, ...bindings: SqlStorageValue[]) {
      const cursor = storage.sql.exec(query, ...bindings);
      if (match(query)) throw new Error(`injected storage failure: ${query}`);
      return cursor;
    },
    get databaseSize(): number {
      return storage.sql.databaseSize;
    },
  };
  // `BoardStore` touches exactly two members, and both are the real thing apart
  // from the injected throw.
  return {
    sql,
    transactionSync: (callback: () => unknown) => storage.transactionSync(callback),
  } as unknown as DurableObjectStorage;
}
