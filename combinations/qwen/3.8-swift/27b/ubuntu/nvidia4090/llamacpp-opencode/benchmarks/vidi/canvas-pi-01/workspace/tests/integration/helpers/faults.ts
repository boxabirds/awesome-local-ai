// SQL fault injection for persistence tests (spec: persist.board_store /
// persist.room Tests). Wraps a BoardStore's SQL surface so matching
// statements throw, letting tests exercise rollback / reset / load-failed
// paths against real Durable Object storage.

import type { BoardSql, BoardStorage } from '../../src/worker/board-store';

/**
 * Wrap a storage's SQL surface so statements matching `failOn` throw.
 * `failOn` is called with the query text and returns true (and the call
 * throws) for the statements that should fail. When `once` is true, only the
 * first matching statement throws (the stub "recovers" afterwards).
 */
export function failingStorage(
  storage: BoardStorage,
  failOn: (query: string) => boolean,
  once = false,
): BoardStorage {
  let fired = false;
  const sql = new Proxy(storage.sql, {
    get(target, prop) {
      if (prop === 'exec') {
        return (query: string, ...bindings: unknown[]) => {
          if (!fired && failOn(query)) {
            if (once) fired = true;
            throw new Error(`injected SQL failure: ${query}`);
          }
          return (target as BoardSql).exec(
            query,
            ...(bindings as (string | number | boolean | null | Uint8Array | ArrayBuffer)[]),
          );
        };
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { sql, transactionSync: (fn) => storage.transactionSync(fn) };
}
