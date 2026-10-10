/**
 * The slice of the Durable Object storage API that `src/worker/board-store.ts`
 * uses, declared for the client tsconfig project only.
 *
 * `board-store.ts` is imported by unit tests (chunking and thresholds are pure
 * functions), and the unit tests are checked by `tsconfig.json`, which has the
 * DOM types and not `@cloudflare/workers-types`. `tsconfig.worker.json` checks
 * the same file against the real declarations, so this file never gets to hide
 * a mistake: if the store used something the real API does not have, the worker
 * project's `npm run typecheck` fails.
 */

export {};

declare global {
  /** Anything a SQLite column can hold. */
  type SqlStorageValue = ArrayBuffer | string | number | null;

  /** The rows one statement returned. Synchronous, because the SQL API is. */
  interface SqlStorageCursor<T extends Record<string, SqlStorageValue>> {
    one(): T;
    toArray(): T[];
    readonly columnNames: string[];
    [Symbol.iterator](): IterableIterator<T>;
  }

  /** Statements, with `?` bindings. */
  interface SqlStorage {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: unknown[]
    ): SqlStorageCursor<T>;
  }

  /** What `ctx.storage` gives a Durable Object. */
  interface DurableObjectStorage {
    sql: SqlStorage;
    transactionSync<T>(closure: () => T): T;
  }
}
