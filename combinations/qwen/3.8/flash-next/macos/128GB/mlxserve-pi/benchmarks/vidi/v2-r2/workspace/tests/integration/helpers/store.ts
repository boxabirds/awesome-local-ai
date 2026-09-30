// A harness for testing `BoardStore` against real SQLite. The only storage this
// store can honestly be tested against is a Durable Object's `ctx.storage`, so
// each test gets its own board id (its own SQLite database) and runs its work
// inside that object with `runInDurableObject`.
//
// The injections are deliberately shaped like the real failures, not like mocked
// ones: `storageFailingOn` wraps the SQL object so a chosen statement throws in
// the middle of `transactionSync` (so the rollback under test is SQLite's), and
// `failingStorage` fails every statement (so the room's save-failure path sees a
// storage error rather than a test's own exception).

import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { newBoardId } from '../../../src/shared/board-id';
import {
  BoardStore,
  META_SCHEMA_VERSION,
  META_SNAPSHOT_THROUGH,
  type BoardDatabase,
  type LoadResult,
  type SqlRow,
} from '../../../src/worker/board-store';

export interface StorageInjection {
  storage: BoardDatabase;
  /** start throwing (statements matching the pattern fail from now on) */
  arm(): void;
  /** stop throwing */
  disarm(): void;
  /** statements that have been rejected, in order */
  readonly thrown: string[];
}

export interface StoreApi {
  boardId: string;
  /** the store under test (migrate() is the test's call, so TC-25 can watch it) */
  store: BoardStore;
  storage: BoardDatabase;
  /** run a query and return all rows as plain objects */
  query(sql: string, ...params: unknown[]): SqlRow[];
  /** rows in one of the store's tables */
  count(table: 'updates' | 'snapshot_chunks' | 'quarantined_updates' | 'storage_meta'): number;
  /** total LENGTH(data) of a table with a data column */
  bytes(table: 'updates' | 'snapshot_chunks' | 'quarantined_updates'): number;
  /** one `storage_meta` value */
  meta(key: string): string | undefined;
  /** a fresh store + fresh doc over the same tables, exactly as a reopen does */
  reopen(): { result: LoadResult; notes: readonly StickySnapshot[]; store: BoardStore };
  /** a store whose SQL throws on statements matching `pattern` when armed */
  storeFailingOn(pattern: RegExp): { store: BoardStore; injection: StorageInjection };
  /** a storage where every statement throws */
  alwaysFailing(): BoardDatabase;
}

/** Get the board's Durable Object stub without ever sending it a request. */
export function roomStub(boardId: string): DurableObjectStub {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Wrap a storage so statements matching `pattern` throw once armed. */
export function failingStorageOn(base: BoardDatabase, pattern: RegExp): StorageInjection {
  const thrown: string[] = [];
  let armed = false;
  const injection: StorageInjection = {
    storage: {
      get sql() {
        return {
          exec(query: string, ...params: unknown[]) {
            if (armed && pattern.test(query)) {
              thrown.push(query.replace(/\s+/g, ' ').trim());
              throw new Error(`injected SQLite failure: ${query.replace(/\s+/g, ' ').trim()}`);
            }
            return base.sql.exec(query, ...params) as never;
          },
        };
      },
      transactionSync<T>(closure: () => T): T {
        return base.transactionSync(closure);
      },
    },
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
    thrown,
  };
  return injection;
}

/** A storage where every statement fails, the way a broken database does. */
export function alwaysFailingStorage(): BoardDatabase {
  const fail = (): never => {
    throw new Error('injected SQLite failure: storage unavailable');
  };
  return {
    get sql() {
      return { exec: fail };
    },
    transactionSync: fail,
  };
}

/**
 * Run `fn` with a store over a brand-new board's SQLite. Each call uses a fresh
 * board id, so no test can see another test's rows.
 */
export function withStore<T>(fn: (api: StoreApi) => T): Promise<T> {
  const boardId = newBoardId();
  const stub = roomStub(boardId);
  return runInDurableObject(
    stub as never,
    ((room: { ctx: { storage: BoardDatabase } }) => {
      const storage = room.ctx.storage;
      const store = new BoardStore(storage);
      const query = (sql: string, ...params: unknown[]): SqlRow[] =>
        [...storage.sql.exec(sql, ...params)].map((row) => ({ ...row }));
      const api: StoreApi = {
        boardId,
        store,
        storage,
        query,
        count: (table) => Number(query(`SELECT COUNT(*) AS n FROM ${table}`)[0]?.n ?? 0),
        bytes: (table) =>
          Number(query(`SELECT COALESCE(SUM(LENGTH(data)), 0) AS b FROM ${table}`)[0]?.b ?? 0),
        meta: (key) => {
          for (const row of query(`SELECT value FROM storage_meta WHERE key = ?1`, key)) {
            return String(row.value);
          }
          return undefined;
        },
        reopen: () => {
          const next = new BoardStore(storage);
          const doc = new Y.Doc();
          const result = next.load(doc);
          return { result, notes: snapshot(doc), store: next };
        },
        storeFailingOn: (pattern) => {
          const injection = failingStorageOn(storage, pattern);
          return { store: new BoardStore(injection.storage), injection };
        },
        alwaysFailing: () => alwaysFailingStorage(),
      };
      return fn(api);
    }) as never,
  ) as never as Promise<T>;
}

export { META_SCHEMA_VERSION, META_SNAPSHOT_THROUGH };
