import * as Y from 'yjs';
import { snapshot } from '@/shared/board-model';
import { BoardStore } from './board-store';
import { type RoomState } from './room-state';

/**
 * Test-only ops, reachable at `/__test/boards/:boardId/:op` ONLY when the
 * worker's TEST_HOOKS binding is '1' (the entry point routes the path; this
 * handler is also only invoked through that route). Never set in production.
 *
 * Ops:
 *   storage-info                 tables, schema version, row/chunk counts,
 *                                quarantine rows, armed failure flags
 *   room-state                   the room state machine (state, lastLoadAttempt)
 *   load-fresh                   run BoardStore.load into a fresh doc
 *   room-append-updates          apply+append (+auto-compact) a batch of
 *                                base64 updates — mirrors the room exactly
 *   store-append                 same for one update
 *   store-compact                BoardStore.compactIfNeeded (force optional)
 *   simulate-reconstruct         drop the room doc and reload from storage
 *                                (simulates a wake from hibernation)
 *   corrupt-update-row           {seq, mode: truncate|random}
 *   corrupt-snapshot             {idx?} — chunk 0 by default (random bytes,
 *                                original kept for `repair`)
 *   repair                       restore everything `corrupt-*` backed up
 *   set-failure                  {target: append|load-select|
 *                                compaction-after-chunk-delete}
 *
 * BLOBs go through `sql.exec` bindings as ArrayBuffer (the installed
 * workers-types expose no `prepare`).
 */

/** The subset of the room the ops need (BoardRoom satisfies this). */
export interface TestableRoom {
  readonly storage: DurableObjectStorage;
  inspectState(): { state: RoomState; lastLoadAttempt: number };
  reconstruct(): { before: RoomState; after: RoomState };
}

// --- helpers ---------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toBuffer(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer;
}

function asBytes(v: unknown): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/**
 * A pristine empty doc — the same load target the room uses. Persisted rows
 * carry the top-level types (the first row is a full state), so no initDoc
 * here: pre-seeding meta would create a duplicate meta item on load.
 */
function freshDoc(): Y.Doc {
  return new Y.Doc();
}

/** Read-only summary of the durable state (for assertions). */
function storageInfo(storage: DurableObjectStorage) {
  const sql = storage.sql;
  const tables = (
    sql.exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).toArray()
  ).map((r) => r.name);
  const meta = (key: string): string | null => {
    const rows = sql.exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
    return rows[0]?.value ?? null;
  };
  const updates = sql.exec<{ c: number; b: number }>(
    'SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM updates',
  ).toArray()[0] ?? { c: 0, b: 0 };
  const chunks = sql.exec<{ c: number; b: number }>(
    'SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(data)), 0) AS b FROM snapshot_chunks',
  ).toArray()[0] ?? { c: 0, b: 0 };
  const quarantined = sql
    .exec<{ seq: number; error: string }>('SELECT seq, error FROM quarantined_updates ORDER BY seq')
    .toArray();
  const failureFlags = (
    sql.exec<{ key: string }>("SELECT key FROM storage_meta WHERE key LIKE 'test%' ORDER BY key").toArray()
  ).map((r) => r.key);
  return {
    tables,
    storageSchemaVersion: meta('storage_schema_version'),
    snapshotThroughSeq: meta('snapshot_through_seq'),
    updates: updates.c,
    updateBytes: updates.b,
    chunks: chunks.c,
    snapshotBytes: chunks.b,
    quarantined,
    failureFlags,
  };
}

function backup(sql: DurableObjectStorage['sql'], kind: string, idx: number, data: Uint8Array): void {
  sql.exec(
    'CREATE TABLE IF NOT EXISTS test_backups (kind TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (kind, idx))',
  );
  sql.exec('INSERT OR REPLACE INTO test_backups (kind, idx, data) VALUES (?, ?, ?)', kind, idx, toBuffer(data));
}

// --- entry ------------------------------------------------------------------

export async function handleTestRequest(request: Request, room: TestableRoom): Promise<Response> {
  try {
    const op = new URL(request.url).pathname.split('/').pop() ?? '';
    const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : {};
    const store = new BoardStore(room.storage);
    const sql = room.storage.sql;

    switch (op) {
      case 'storage-info':
        return json(storageInfo(room.storage));

      case 'room-state':
        return json(room.inspectState());

      case 'load-fresh': {
        const doc = freshDoc();
        const result = store.load(doc);
        return json({ result, notes: result.ok ? snapshot(doc) : [] });
      }

      case 'room-append-updates': {
        // Mirrors the room: load current state, then apply + append +
        // auto-compact for each update.
        const updates = (body.updates as unknown as string[] | undefined) ?? [];
        const doc = freshDoc();
        store.load(doc);
        let appended = 0;
        let compacted = 0;
        for (const s of updates) {
          const u = b64ToBytes(s);
          Y.applyUpdate(doc, u, 'seed');
          store.append(u);
          appended += 1;
          if (store.compactIfNeeded(doc)) compacted += 1;
        }
        return json({ appended, compacted, storage: storageInfo(room.storage) });
      }

      case 'store-append': {
        const s = body.update as string | undefined;
        if (!s) return json({ error: 'missing update' }, 400);
        const doc = freshDoc();
        store.load(doc);
        const u = b64ToBytes(s);
        Y.applyUpdate(doc, u, 'seed');
        store.append(u);
        return json({ ok: true, storage: storageInfo(room.storage) });
      }

      case 'store-compact': {
        const doc = freshDoc();
        store.load(doc);
        const compacted = store.compactIfNeeded(doc, body.force === true);
        return json({ compacted, storage: storageInfo(room.storage) });
      }

      case 'simulate-reconstruct':
        return json(room.reconstruct());

      case 'corrupt-update-row': {
        const seq = Number(body.seq);
        if (!Number.isInteger(seq)) return json({ error: 'bad seq' }, 400);
        const mode = body.mode === 'random' ? 'random' : 'truncate';
        const row = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = ?', seq).toArray()[0];
        if (!row) return json({ error: 'no such update row' }, 404);
        const original = asBytes(row.data);
        backup(sql, 'update', seq, original);
        const corrupted =
          mode === 'truncate'
            ? original.slice(0, Math.max(0, original.length - 10))
            : randomBytes(original.length);
        sql.exec('UPDATE updates SET data = ? WHERE seq = ?', toBuffer(corrupted), seq);
        return json({ ok: true, seq, mode });
      }

      case 'corrupt-snapshot': {
        const idx = Number(body.idx ?? 0);
        if (!Number.isInteger(idx)) return json({ error: 'bad idx' }, 400);
        const row = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = ?', idx).toArray()[0];
        if (!row) return json({ error: 'no such snapshot chunk' }, 404);
        const original = asBytes(row.data);
        backup(sql, 'snapshot', idx, original);
        sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', toBuffer(randomBytes(original.length)), idx);
        return json({ ok: true, idx });
      }

      case 'repair': {
        const rows = sql
          .exec<{ kind: string; idx: number; data: ArrayBuffer }>('SELECT kind, idx, data FROM test_backups')
          .toArray();
        let repairedSnapshot = 0;
        let repairedUpdates = 0;
        for (const r of rows) {
          const data = asBytes(r.data);
          if (r.kind === 'snapshot') {
            sql.exec('INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (?, ?)', r.idx, toBuffer(data));
            repairedSnapshot += 1;
          } else {
            sql.exec('INSERT OR REPLACE INTO updates (seq, data, bytes) VALUES (?, ?, ?)', r.idx, toBuffer(data), data.length);
            repairedUpdates += 1;
          }
        }
        sql.exec('DELETE FROM test_backups');
        return json({ repairedSnapshot, repairedUpdates });
      }

      case 'set-failure': {
        const target = body.target as string | undefined;
        const key =
          target === 'append'
            ? 'test_fail_append'
            : target === 'load-select'
              ? 'test_fail_load_select'
              : target === 'compaction-after-chunk-delete'
                ? 'test_fail_compaction_after_chunk_delete'
                : null;
        if (!key) return json({ error: 'unknown failure target' }, 400);
        sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', key, '1');
        return json({ armed: key });
      }

      default:
        return json({ error: `unknown op: ${op}` }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
