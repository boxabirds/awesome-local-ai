// tests/integration/helpers/mock-storage.ts
// In-memory mock of Durable Object storage for integration tests.
// Implements the same interface as DurableObjectStorage but uses in-memory data structures.
// This exercises the real BoardStore logic (chunking, quarantine, compaction, SQL semantics)
// without requiring the workerd runtime.

interface Row {
  [key: string]: string | number | Uint8Array;
}

class MockStatement {
  private query: string;
  private db: MockSql;

  constructor(query: string, db: MockSql) {
    this.query = query.trim().replace(/\s+/g, ' ');
    this.db = db;
  }

  run(...params: (string | number | Uint8Array | null)[]): void {
    this.db.execute(this.query, 'run', params);
  }

  get(...params: (string | number | Uint8Array | null)[]): Row | null {
    const results = this.db.execute(this.query, 'all', params);
    return results.length > 0 ? results[0] : null;
  }

  all(...params: (string | number | Uint8Array | null)[]): Row[] {
    return this.db.execute(this.query, 'all', params);
  }
}

class MockSql {
  // Tables
  storageMeta: Map<string, string> = new Map();
  updates: Map<number, { data: Uint8Array; bytes: number }> = new Map();
  snapshotChunks: Map<number, Uint8Array> = new Map();
  quarantinedUpdates: Map<number, { data: Uint8Array; error: string; quarantined_at: number }> = new Map();

  // Track which tables have been "created" via exec()
  createdTables: Set<string> = new Set();

  private _nextSeq = 1;

  prepare(q: string): MockStatement {
    return new MockStatement(q, this);
  }

  exec(query: string): void {
    // Parse CREATE TABLE IF NOT EXISTS statements
    const tableMatches = query.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g);
    for (const match of tableMatches) {
      this.createdTables.add(match[1]);
    }
  }

  execute(query: string, _mode: 'run' | 'all', params: (string | number | Uint8Array | null)[]): Row[] {
    const q = query.trim().replace(/\s+/g, ' ');

    // sqlite_master queries
    if (q.startsWith('SELECT name FROM sqlite_master')) {
      // Check which tables from the IN clause exist
      const inMatch = q.match(/name IN \(([^)]+)\)/);
      if (inMatch) {
        const names = inMatch[1].split(',').map(s => s.trim().replace(/'/g, ''));
        const results: Row[] = [];
        for (const name of names) {
          if (this.createdTables.has(name)) {
            results.push({ name });
          }
        }
        return results;
      }
      // Return all created tables
      return [...this.createdTables].map(name => ({ name }));
    }

    // INSERT INTO storage_meta (handles both INSERT and INSERT OR REPLACE)
    if (q.startsWith('INSERT INTO storage_meta') || q.startsWith('INSERT OR REPLACE INTO storage_meta')) {
      const key = params[0] as string;
      const value = params[1] as string;
      this.storageMeta.set(key, value);
      return [];
    }

    // SELECT from storage_meta
    if (q.startsWith('SELECT value FROM storage_meta WHERE key = ?')) {
      const key = params[0] as string;
      const value = this.storageMeta.get(key);
      if (value !== undefined) return [{ value }];
      return [];
    }

    // DELETE FROM storage_meta
    if (q.startsWith('DELETE FROM storage_meta WHERE key = ?')) {
      const key = params[0] as string;
      this.storageMeta.delete(key);
      return [];
    }

    // INSERT INTO updates
    if (q.startsWith('INSERT INTO updates (data, bytes)')) {
      const data = params[0] as Uint8Array;
      const bytes = params[1] as number;
      this.updates.set(this._nextSeq, { data, bytes });
      this._nextSeq++;
      return [];
    }

    // SELECT from updates (handles both parameterized and literal forms)
    if (q.startsWith('SELECT seq, data FROM updates WHERE seq > ')) {
      let minSeq: number;
      if (q.includes('?')) {
        minSeq = params[0] as number;
      } else {
        const match = q.match(/seq > (\d+)/);
        minSeq = match ? parseInt(match[1], 10) : 0;
      }
      const results: Row[] = [];
      for (const [seq, row] of this.updates) {
        if (seq > minSeq) {
          results.push({ seq, data: row.data });
        }
      }
      results.sort((a, b) => (a.seq as number) - (b.seq as number));
      return results;
    }

    // SELECT COUNT(*) from updates (with or without WHERE clause)
    if (q.startsWith('SELECT COUNT(*) as cnt FROM updates')) {
      if (q.includes('WHERE seq >')) {
        let minSeq: number;
        if (q.includes('?')) {
          minSeq = params[0] as number;
        } else {
          const match = q.match(/seq > (\d+)/);
          minSeq = match ? parseInt(match[1], 10) : 0;
        }
        let count = 0;
        for (const seq of this.updates.keys()) {
          if (seq > minSeq) count++;
        }
        return [{ cnt: count }];
      }
      // No WHERE clause - count all
      return [{ cnt: this.updates.size }];
    }

    // SELECT COALESCE(SUM(bytes), 0) from updates
    if (q.startsWith('SELECT COALESCE(SUM(bytes), 0) as total FROM updates WHERE seq > ?')) {
      const minSeq = params[0] as number;
      let total = 0;
      for (const [seq, row] of this.updates) {
        if (seq > minSeq) total += row.bytes;
      }
      return [{ total }];
    }

    // SELECT COALESCE(MAX(seq), 0) from updates
    if (q.startsWith('SELECT COALESCE(MAX(seq), 0) as max_seq FROM updates')) {
      let maxSeq = 0;
      for (const seq of this.updates.keys()) {
        if (seq > maxSeq) maxSeq = seq;
      }
      return [{ max_seq: maxSeq }];
    }

    // DELETE FROM updates WHERE seq = ?
    if (q.startsWith('DELETE FROM updates WHERE seq = ?')) {
      const seq = params[0] as number;
      this.updates.delete(seq);
      return [];
    }

    // DELETE FROM updates WHERE seq <= ?
    if (q.startsWith('DELETE FROM updates WHERE seq <= ?')) {
      const maxSeq = params[0] as number;
      for (const seq of [...this.updates.keys()]) {
        if (seq <= maxSeq) this.updates.delete(seq);
      }
      return [];
    }

    // SELECT data FROM snapshot_chunks ORDER BY idx
    if (q.startsWith('SELECT data FROM snapshot_chunks ORDER BY idx')) {
      const results: Row[] = [];
      const indices = [...this.snapshotChunks.keys()].sort((a, b) => a - b);
      for (const idx of indices) {
        results.push({ data: this.snapshotChunks.get(idx)! });
      }
      return results;
    }

    // SELECT COUNT(*) from snapshot_chunks
    if (q.startsWith('SELECT COUNT(*) as cnt FROM snapshot_chunks')) {
      return [{ cnt: this.snapshotChunks.size }];
    }

    // DELETE FROM snapshot_chunks
    if (q.startsWith('DELETE FROM snapshot_chunks')) {
      this.snapshotChunks.clear();
      return [];
    }

    // INSERT INTO snapshot_chunks
    if (q.startsWith('INSERT INTO snapshot_chunks (idx, data)')) {
      const idx = params[0] as number;
      const data = params[1] as Uint8Array;
      this.snapshotChunks.set(idx, data);
      return [];
    }

    // UPDATE snapshot_chunks SET data = ? WHERE idx = ?
    if (q.startsWith('UPDATE snapshot_chunks SET data = ? WHERE idx = ?')) {
      const data = params[0] as Uint8Array;
      const idx = params[1] as number;
      this.snapshotChunks.set(idx, data);
      return [];
    }

    // UPDATE snapshot_chunks SET data = ? WHERE idx = 0 (literal)
    if (q.startsWith('UPDATE snapshot_chunks SET data = ? WHERE idx = 0')) {
      const data = params[0] as Uint8Array;
      this.snapshotChunks.set(0, data);
      return [];
    }

    // INSERT INTO quarantined_updates
    if (q.startsWith('INSERT INTO quarantined_updates')) {
      const seq = params[0] as number;
      const data = params[1] as Uint8Array;
      const error = params[2] as string;
      const quarantined_at = params[3] as number;
      this.quarantinedUpdates.set(seq, { data, error, quarantined_at });
      return [];
    }

    // SELECT from quarantined_updates
    if (q.startsWith('SELECT * FROM quarantined_updates')) {
      const results: Row[] = [];
      for (const [seq, row] of this.quarantinedUpdates) {
        results.push({ seq, data: row.data, error: row.error, quarantined_at: row.quarantined_at });
      }
      return results;
    }

    // SELECT COUNT(*) from quarantined_updates
    if (q.startsWith('SELECT COUNT(*) as cnt FROM quarantined_updates')) {
      return [{ cnt: this.quarantinedUpdates.size }];
    }

    throw new Error(`MockSql: unsupported query: ${q}`);
  }

  // For testing: get raw table data
  getUpdatesCount(): number {
    return this.updates.size;
  }

  getSnapshotChunksCount(): number {
    return this.snapshotChunks.size;
  }

  getQuarantinedCount(): number {
    return this.quarantinedUpdates.size;
  }

  getUpdateAtSeq(seq: number): { data: Uint8Array; bytes: number } | undefined {
    return this.updates.get(seq);
  }

  setUpdateAtSeq(seq: number, data: Uint8Array): void {
    const existing = this.updates.get(seq);
    if (existing) {
      this.updates.set(seq, { data, bytes: data.length });
    }
  }

  // For testing: check if tables exist
  hasTable(name: string): boolean {
    return this.createdTables.has(name);
  }

  // For testing: get all table names
  getTables(): string[] {
    return [...this.createdTables];
  }
}

export class MockDurableObjectStorage {
  sql: MockSql;
  private snapshots: { storageMeta: Map<string, string>; updates: Map<number, { data: Uint8Array; bytes: number }>; snapshotChunks: Map<number, Uint8Array>; quarantinedUpdates: Map<number, { data: Uint8Array; error: string; quarantined_at: number }>; nextSeq: number; createdTables: Set<string> }[] = [];

  // For testing: inject failure at a specific statement index within the next transaction
  failTransactionAtStatement: number | null = null;
  private txStmtCount = 0;

  constructor() {
    this.sql = new MockSql();
  }

  get transactionSync() {
    const self = this;
    return {
      run: (fn: () => void) => {
        // Take a snapshot
        self.snapshots.push({
          storageMeta: new Map(self.sql.storageMeta),
          updates: new Map([...self.sql.updates].map(([k, v]) => [k, { data: new Uint8Array(v.data), bytes: v.bytes }])),
          snapshotChunks: new Map([...self.sql.snapshotChunks].map(([k, v]) => [k, new Uint8Array(v)])),
          quarantinedUpdates: new Map([...self.sql.quarantinedUpdates].map(([k, v]) => [k, { data: new Uint8Array(v.data), error: v.error, quarantined_at: v.quarantined_at }])),
          nextSeq: (self.sql as any)._nextSeq,
          createdTables: new Set(self.sql.createdTables),
        });

        self.txStmtCount = 0;

        // If failure injection is active, wrap prepare to count statements
        const failAt = self.failTransactionAtStatement;
        let origPrepare: typeof self.sql.prepare | null = null;
        if (failAt !== null) {
          origPrepare = self.sql.prepare.bind(self.sql);
          (self.sql as any).prepare = (q: string) => {
            self.txStmtCount++;
            if (self.txStmtCount === failAt) {
              return {
                run: () => { throw new Error('Injected SQL failure'); },
                get: () => null,
                all: () => [],
              };
            }
            return origPrepare!(q);
          };
        }

        try {
          fn();
        } catch (e) {
          // Rollback
          const snap = self.snapshots.pop()!;
          self.sql.storageMeta = snap.storageMeta;
          self.sql.updates = snap.updates;
          self.sql.snapshotChunks = snap.snapshotChunks;
          self.sql.quarantinedUpdates = snap.quarantinedUpdates;
          (self.sql as any)._nextSeq = snap.nextSeq;
          self.sql.createdTables = snap.createdTables;
          throw e;
        } finally {
          if (origPrepare) {
            (self.sql as any).prepare = origPrepare;
          }
          self.failTransactionAtStatement = null;
        }
      },
    };
  }

  get kv() {
    return {
      get: <T>(_key: string): T | null => null,
      set: (_key: string, _value: unknown): void => {},
    };
  }
}

export type { MockSql };
