/**
 * Test hooks (story 4, task 3/9).
 *
 * HTTP endpoints that run real BoardStore SQL and room operations inside
 * the Durable Object (the worker calls a stub method on the object, which
 * executes in the object's actor context) so integration tests can drive
 * and damage real storage. Enabled ONLY when env.TEST_HOOKS === '1'
 * (set by the test wrangler processes); production requests never match
 * the route and the hook methods refuse to run.
 *
 * Routes (all POST JSON): /__test/boards/:boardId/:op
 *  store-migrate, store-append {data}, store-append-many {updates},
 *  store-load, store-compact {force?, failAfterChunkDelete?},
 *  store-corrupt-log-row {seq, mode}, store-corrupt-snapshot-chunk {idx, mode},
 *  store-repair-snapshot-chunk {idx}, store-status,
 *  board-initialize, raw-sql {sql, params?},
 *  room-reset, room-inject {append?, load?, reset?}, room-compact-now,
 *  corrupt-snapshot, repair-snapshot
 * and the worker-level fault route
 *  /__test/faults/create-board {mode: 'throw' | 'exists' | 'clear'}
 */
import * as Y from 'yjs';
import { snapshot } from '../shared/board-model';
import type { Env } from './index';
import { BoardStore, type CompactHooks } from './board-store';
import type { BoardRoom } from './board-room';
import { injectInitializeForTests } from './create-board';

interface HookSession {
  store: BoardStore;
  doc: Y.Doc;
}

/**
 * Per-process cache of hook store+doc pairs. The store keeps the log
 * counters (needed for threshold compaction) and the doc mirrors every
 * hook-appended update so a forced compaction snapshots the full state.
 */
const sessions = new Map<string, HookSession>();

function session(storage: DurableObjectStorage, boardId: string): HookSession {
  let s = sessions.get(boardId);
  if (!s) {
    const store = new BoardStore(storage);
    store.migrate();
    const doc = new Y.Doc();
    store.load(doc);
    s = { store, doc };
    sessions.set(boardId, s);
  }
  return s;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toUint8(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
      ? value
      : value.slice();
  }
  return new Uint8Array(value as ArrayBuffer);
}

function firstRow(cursor: Iterable<unknown[]>): unknown[] | undefined {
  return cursor[Symbol.iterator]().next().value as unknown[] | undefined;
}

function randomSameLength(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  crypto.getRandomValues(out);
  return out;
}

function truncated(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, Math.max(0, bytes.length - 10));
}

export async function testHookRequest(req: Request, env: Env, pathname: string): Promise<Response> {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== '__test') {
    return json({ ok: false, error: 'unknown test route' }, 404);
  }
  // Worker-level fault injection (story 5, TC-12): replaces the
  // initialize() RPC that createBoard makes. Not per-board because creation
  // picks the id; the tests clear it again afterwards.
  if (parts[1] === 'faults' && parts[2] === 'create-board') {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      /* bodyless */
    }
    const mode = body.mode;
    if (mode === 'throw') {
      injectInitializeForTests(async () => {
        throw new Error('injected initialize failure');
      });
      return json({ ok: true });
    }
    if (mode === 'exists') {
      injectInitializeForTests(async () => 'exists');
      return json({ ok: true });
    }
    if (mode === 'clear') {
      injectInitializeForTests(null);
      return json({ ok: true });
    }
    return json({ ok: false, error: "expected { mode: 'throw' | 'exists' | 'clear' }" }, 400);
  }
  if (parts.length !== 4 || parts[1] !== 'boards') {
    return json({ ok: false, error: 'unknown test route' }, 404);
  }
  const boardId = decodeURIComponent(parts[2]);
  const op = parts[3];
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'POST only' }, 405);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* bodyless */
  }
  // The stub RPC executes the method inside the object's actor context
  // (this workerd build does not provide runInDurableObject). The first
  // call to a board constructs the object, same as a client connection.
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const result = await room.__testHook(boardId, op, body);
  return json(result);
}

/** Runs inside the Durable Object; every storage touch is real SQLite. */
export async function runTestHook(
  storage: DurableObjectStorage,
  room: BoardRoom,
  boardId: string,
  op: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const sql = storage.sql;
  switch (op) {
    case 'store-migrate': {
      const store = new BoardStore(storage);
      store.migrate();
      return { ok: true };
    }
    case 'board-initialize': {
      // Runs the real creation RPC (migrate + created_at written once).
      return { result: await room.initialize() };
    }
    case 'raw-sql': {
      // Raw storage access for states no other hook can build (e.g. a
      // legacy updates table without a schema-version row, TC-08b).
      const sqlText = String(body.sql);
      const params = Array.isArray(body.params) ? (body.params as unknown[]) : [];
      sql.exec(sqlText, ...params);
      return { ok: true };
    }
    case 'store-append': {
      const s = session(storage, boardId);
      const update = fromBase64(String(body.data));
      s.store.append(update);
      Y.applyUpdate(s.doc, update, 'hook');
      return { ok: true };
    }
    case 'store-append-many': {
      const s = session(storage, boardId);
      const updates = (body.updates as string[]).map(fromBase64);
      for (const u of updates) {
        s.store.append(u);
        Y.applyUpdate(s.doc, u, 'hook');
      }
      return { ok: true, count: updates.length };
    }
    case 'store-load': {
      const store = new BoardStore(storage);
      const doc = new Y.Doc();
      const result = store.load(doc);
      return { result, notes: snapshot(doc) };
    }
    case 'store-compact': {
      const s = session(storage, boardId);
      const hooks: CompactHooks | undefined = body.failAfterChunkDelete
        ? {
            afterChunkDelete: () => {
              throw new Error('injected compaction failure');
            },
          }
        : undefined;
      const compacted = body.force
        ? s.store.compact(s.doc, hooks)
        : s.store.compactIfNeeded(s.doc, hooks);
      return { compacted };
    }
    case 'store-corrupt-log-row': {
      const seq = Number(body.seq);
      const mode = String(body.mode);
      const row = firstRow(sql.exec('SELECT data FROM updates WHERE seq = ?', seq).raw());
      if (!row) return { ok: false, error: 'no such log row' };
      const data = toUint8(row[0]);
      const damaged = mode === 'truncated' ? truncated(data) : randomSameLength(data);
      sql.exec('UPDATE updates SET data = ? WHERE seq = ?', damaged, seq);
      return { ok: true };
    }
    case 'store-corrupt-snapshot-chunk': {
      const idx = Number(body.idx);
      const mode = String(body.mode);
      const row = firstRow(sql.exec('SELECT data FROM snapshot_chunks WHERE idx = ?', idx).raw());
      if (!row) return { ok: false, error: 'no such chunk' };
      const data = toUint8(row[0]);
      sql.exec(
        'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
        `test_backup_chunk_${idx}`,
        toBase64(data),
      );
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', randomSameLength(data), idx);
      return { ok: true, idx };
    }
    case 'store-repair-snapshot-chunk': {
      const idx = Number(body.idx);
      const row = firstRow(
        sql.exec('SELECT value FROM storage_meta WHERE key = ?', `test_backup_chunk_${idx}`).raw(),
      );
      if (!row) return { ok: false, error: 'no backup' };
      const data = fromBase64(String(row[0]));
      sql.exec('DELETE FROM storage_meta WHERE key = ?', `test_backup_chunk_${idx}`);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', data, idx);
      return { ok: true };
    }
    case 'store-status': {
      // Story 5: an unknown board has no tables at all, so every probe must
      // be guarded (this is how tests assert "nothing was materialized").
      // Only the board's own storage tables are listed (workerd adds internal
      // tables like __miniflare_do_name to every DO database).
      const tables: string[] = [];
      for (const row of sql
        .exec(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('updates', 'snapshot_chunks', 'quarantined_updates', 'storage_meta')",
        )
        .raw()) {
        tables.push(String(row[0]));
      }
      const has = (t: string): boolean => tables.includes(t);
      const count = (table: string, query: string): number =>
        has(table) ? Number(firstRow(sql.exec(query).raw())?.[0] ?? 0) : 0;
      const meta = (key: string): string | null => {
        if (!has('storage_meta')) return null;
        const row = firstRow(sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).raw());
        return row ? String(row[0]) : null;
      };
      const throughSeq = meta('snapshot_through_seq');
      return {
        tables,
        createdAt: meta('created_at'),
        schemaVersion: meta('storage_schema_version'),
        updates: {
          count: count('updates', 'SELECT COUNT(*) FROM updates'),
          bytes: count('updates', 'SELECT COALESCE(SUM(bytes), 0) FROM updates'),
        },
        chunks: count('snapshot_chunks', 'SELECT COUNT(*) FROM snapshot_chunks'),
        snapshotBytes: count('snapshot_chunks', 'SELECT COALESCE(SUM(length(data)), 0) FROM snapshot_chunks'),
        throughSeq: throughSeq === null ? 0 : Number(throughSeq),
        quarantined: has('quarantined_updates')
          ? [...sql.exec('SELECT seq, error FROM quarantined_updates ORDER BY seq').raw()].map(
              ([seq, error]) => ({ seq: Number(seq), error: String(error) }),
            )
          : [],
      };
    }
    case 'room-reset': {
      room.__testReset();
      return { ok: true };
    }
    case 'room-inject': {
      room.__testInject({
        append: body.append as 'once' | 'always' | undefined,
        load: body.load as 'once' | 'always' | undefined,
        reset: Boolean(body.reset),
      });
      return { ok: true };
    }
    case 'room-compact-now': {
      return { compacted: room.__testCompactNow() };
    }
    case 'corrupt-snapshot': {
      const row = firstRow(sql.exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx LIMIT 1').raw());
      if (!row) return { ok: false, error: 'no snapshot yet' };
      const idx = Number(row[0]);
      const data = toUint8(row[1]);
      sql.exec(
        'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
        `test_backup_chunk_${idx}`,
        toBase64(data),
      );
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', randomSameLength(data), idx);
      // The running room still holds the loaded doc; force it to reload so
      // the next connection hits the corrupted snapshot.
      room.__testReset();
      return { ok: true, idx };
    }
    case 'repair-snapshot': {
      const row = firstRow(
        sql.exec('SELECT key, value FROM storage_meta WHERE key LIKE ?', 'test_backup_chunk_%').raw(),
      );
      if (!row) return { ok: false, error: 'no backup' };
      const key = String(row[0]);
      const data = fromBase64(String(row[1]));
      sql.exec('DELETE FROM storage_meta WHERE key = ?', key);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', data, Number(key.slice('test_backup_chunk_'.length)));
      return { ok: true };
    }
    default:
      return { ok: false, error: `unknown op: ${op}` };
  }
}
