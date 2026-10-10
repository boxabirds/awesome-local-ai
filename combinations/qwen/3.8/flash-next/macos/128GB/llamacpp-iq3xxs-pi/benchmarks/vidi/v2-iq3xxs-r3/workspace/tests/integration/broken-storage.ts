/**
 * Making storage fail on purpose (persist.board_store, persist.save_failure).
 *
 * The failures this story has to survive are rare ones — a write that does not
 * land, a read that throws, a snapshot that cannot be read. Waiting for them to
 * happen would mean never testing them, and the design says to simulate them.
 *
 * The way to simulate them here is to replace the `sql` of a Durable Object's
 * `DurableObjectStorage` with a façade that throws for matching statements and
 * passes everything else through to the real thing. The real `transactionSync`
 * stays in charge, so rollback semantics are the runtime's own, not a fake's
 * idea of them; and the store's own code path is unchanged, so a test that
 * passes here describes what happens when the real thing throws.
 */

/**
 * Putting the `sql` of a `DurableObjectStorage` back. Which statements it
 * refused is on the function itself: "the room did not even try" is a thing
 * tests need to say.
 */
export type RestoreSql = (() => void) & {
  /** Every statement it refused, in order. */
  readonly refused: string[];
};

/**
 * Statements that should throw, described by what they are asked to do.
 * `limit` lets a failure be a one-off, which is what a write that failed looks
 * like: the room reacts, and the next attempt is a normal one.
 */
export function breakSql(
  storage: DurableObjectStorage,
  when: (query: string) => boolean,
  message = 'simulated storage failure',
  limit = Number.POSITIVE_INFINITY,
): RestoreSql {
  const real = storage.sql;
  const refused: string[] = [];
  const broken: SqlStorage = new Proxy(real, {
    get(target, property) {
      if (property !== 'exec') return Reflect.get(target, property);
      return (query: string, ...bindings: SqlStorageValue[]) => {
        if (when(query) && refused.length < limit) {
          refused.push(query);
          throw new Error(message);
        }
        return target.exec(query, ...bindings);
      };
    },
  });
  Object.defineProperty(storage, 'sql', { configurable: true, value: broken });
  return Object.assign(
    () => {
      Object.defineProperty(storage, 'sql', { configurable: true, value: real });
    },
    { refused },
  );
}

/**
 * A `sql` that tells the test what it was asked, and refuses nothing. "the room
 * did not even try to read the board again" is a claim about statements, and
 * this is how you hear them.
 */
export type WatchedSql = {
  /** Every statement the object ran, in order. */
  readonly seen: string[];
  restore(): void;
};

export function watchSql(storage: DurableObjectStorage): WatchedSql {
  const real = storage.sql;
  const seen: string[] = [];
  const watched: SqlStorage = new Proxy(real, {
    get(target, property) {
      if (property !== 'exec') return Reflect.get(target, property);
      return (query: string, ...bindings: SqlStorageValue[]) => {
        seen.push(query);
        return target.exec(query, ...bindings);
      };
    },
  });
  Object.defineProperty(storage, 'sql', { configurable: true, value: watched });
  return { seen, restore: () => Object.defineProperty(storage, 'sql', { configurable: true, value: real }) };
}

/** Rows of a query, as plain objects, so a failure message is readable. */
export function query(
  storage: DurableObjectStorage,
  sql: string,
  ...bindings: SqlStorageValue[]
): Record<string, SqlStorageValue>[] {
  return storage.sql.exec(sql, ...bindings).toArray();
}

/** How many rows a table holds. */
export function countRows(storage: DurableObjectStorage, table: string): number {
  // `table` is a literal in the tests, never a value from outside.
  const row = storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one();
  return Number(row.n);
}

/** The tables this board's storage has, by name. */
export function tableNames(storage: DurableObjectStorage): string[] {
  return query(storage, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith('sqlite_'));
}

/** `seq`s of the logged updates, oldest first. */
export function updateSeqs(storage: DurableObjectStorage): number[] {
  return query(storage, 'SELECT seq FROM updates ORDER BY seq ASC').map((row) => Number(row.seq));
}

/** A `Uint8Array` in the form a `BLOB` binding wants. */
export function blob(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
