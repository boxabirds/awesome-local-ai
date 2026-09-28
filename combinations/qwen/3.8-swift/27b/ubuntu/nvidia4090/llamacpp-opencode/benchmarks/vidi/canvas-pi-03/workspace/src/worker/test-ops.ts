/**
 * Story 4: test-only operations for driving persist.board_store (and the
 * persistence failure paths) against a board's real Durable Object SQLite.
 *
 * These routes are ONLY reachable when the worker has TEST_HOOKS enabled
 * (`env.TEST_HOOKS === '1'`), which is set in the test/e2e environments and
 * never in production. The worker routes `/__test/boards/:id/:op` to the
 * board's Durable Object; `handleTestOp` runs the operation against
 * `ctx.storage` and returns a JSON response.
 *
 * Ops:
 *   GET  /inspect            → schema version + row/chunk counts + notes
 *   POST /append             → append one or more Yjs updates to the log
 *   POST /load               → load into a fresh Y.Doc (quarantine path)
 *   POST /compact            → load then compactIfNeeded
 *   POST /force-compact      → load then compact unconditionally (small boards)
 *   POST /damage-log-row     → overwrite a log row with damaged bytes
 *   POST /corrupt-snapshot   → back up then overwrite snapshot chunk 0
 *   POST /repair-snapshot    → restore snapshot chunk 0 from backup
 *   POST /compact-throw      → run a compaction txn that fails mid-way (rollback)
 */
import * as Y from 'yjs';
import { BoardStore } from './board-store';
import { snapshot, initDoc } from 'src/shared/board-model';

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SNAPSHOT_BACKUP_KEY = 'test_snapshot_backup';

async function handleTestOp(storage: DurableObjectStorage, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // parts = ['__test', 'boards', <id>, <op>]
  const op = parts[3] ?? '';
  const sql = storage.sql;

  switch (op) {
    case 'inspect': {
      const store = new BoardStore(storage);
      const updateCount = Number(sql.exec('SELECT COUNT(*) AS c FROM updates').one().c);
      const chunkCount = Number(sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c);
      const quarantinedCount = Number(sql.exec('SELECT COUNT(*) AS c FROM quarantined_updates').one().c);
      const throughRows = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
        .toArray();
      const throughSeq = throughRows.length > 0 ? Number(throughRows[0].value) : 0;
      const doc = new Y.Doc();
      initDoc(doc);
      store.load(doc);
      return json({
        schemaVersion: store.schemaVersion(),
        updateCount,
        chunkCount,
        quarantinedCount,
        throughSeq,
        notes: snapshot(doc),
      });
    }

    case 'append': {
      const body = await req.json().catch(() => null) as
        | { updates?: string[] }
        | null;
      const updates = body?.updates ?? [];
      const store = new BoardStore(storage);
      for (const b64 of updates) store.append(fromBase64(b64));
      return json({ ok: true, appended: updates.length });
    }

    case 'load': {
      const store = new BoardStore(storage);
      const doc = new Y.Doc();
      initDoc(doc);
      const result = store.load(doc);
      if (result.ok) {
        return json({ ok: true, quarantined: result.quarantined, notes: snapshot(doc) });
      }
      return json({ ok: false, reason: result.reason, error: result.error });
    }

    case 'compact': {
      const store = new BoardStore(storage);
      const doc = new Y.Doc();
      initDoc(doc);
      store.load(doc);
      const compacted = store.compactIfNeeded(doc);
      const chunkCount = Number(sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c);
      const updateCount = Number(sql.exec('SELECT COUNT(*) AS c FROM updates').one().c);
      return json({ compacted, chunks: chunkCount, logCount: updateCount });
    }

    case 'force-compact': {
      // Unconditional compaction so a small board can be snapshotted (the
      // snapshot-corruption e2e needs a chunk to corrupt).
      const store = new BoardStore(storage);
      const doc = new Y.Doc();
      initDoc(doc);
      store.load(doc);
      const compacted = store.forceCompact(doc);
      const chunkCount = Number(sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c);
      const updateCount = Number(sql.exec('SELECT COUNT(*) AS c FROM updates').one().c);
      return json({ compacted, chunks: chunkCount, logCount: updateCount });
    }

    case 'damage-log-row': {
      const body = (await req.json().catch(() => null)) as
        | { seq: number; mode?: 'truncate' | 'random' }
        | null;
      if (!body || typeof body.seq !== 'number') return fail('missing seq');
      const rows = sql.exec('SELECT data, bytes FROM updates WHERE seq = ?', body.seq).toArray();
      if (rows.length === 0) return fail(`no row for seq ${body.seq}`);
      const data = new Uint8Array(rows[0].data as ArrayBuffer);
      let damaged: Uint8Array;
      if (body.mode === 'random') {
        damaged = new Uint8Array(data.length);
        for (let i = 0; i < damaged.length; i++) damaged[i] = (i * 37 + 11) % 256;
      } else {
        // truncate: cut the last 10 bytes (same length would be "random").
        const cut = Math.min(10, data.length);
        damaged = data.subarray(0, data.length - cut);
      }
      sql.exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = ?', damaged, damaged.byteLength, body.seq);
      return json({ ok: true, seq: body.seq, damagedBytes: damaged.byteLength });
    }

    case 'corrupt-snapshot': {
      const rows = sql.exec('SELECT idx, data FROM snapshot_chunks WHERE idx = 0').toArray();
      if (rows.length === 0) return fail('no snapshot chunk 0');
      const original = new Uint8Array(rows[0].data as ArrayBuffer);
      sql.exec(
        'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
        SNAPSHOT_BACKUP_KEY,
        toBase64(original),
      );
      const corrupt = new Uint8Array(original.length + 3);
      for (let i = 0; i < corrupt.length; i++) corrupt[i] = 0xff;
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', corrupt);
      return json({ ok: true });
    }

    case 'repair-snapshot': {
      const backup = sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', SNAPSHOT_BACKUP_KEY)
        .toArray();
      if (backup.length === 0) return fail('no snapshot backup');
      const original = fromBase64(backup[0].value as string);
      sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', original);
      sql.exec('DELETE FROM storage_meta WHERE key = ?', SNAPSHOT_BACKUP_KEY);
      return json({ ok: true });
    }

    case 'fail-select': {
      // Arm a one-shot SELECT failure so the next construct's load reports
      // sql-error (persist.load_failure sql-error path, TC-26). Persistent.
      const store = new BoardStore(storage);
      store.armSelectFailure();
      return json({ ok: true });
    }

    case 'compact-throw': {
      // Replicates compactIfNeeded's transaction but throws after deleting the
      // old chunks, before the new chunks are written. The platform must roll
      // the whole transaction back (previous chunks and log stay intact).
      const store = new BoardStore(storage);
      const doc = new Y.Doc();
      initDoc(doc);
      store.load(doc);
      const beforeChunks = Number(sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c);
      const beforeUpdates = Number(sql.exec('SELECT COUNT(*) AS c FROM updates').one().c);
      const maxSeq = Number(sql.exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one().m);
      let threw = false;
      try {
        storage.transactionSync(() => {
          sql.exec('DELETE FROM snapshot_chunks');
          const snap = Y.encodeStateAsUpdate(doc);
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, snap);
          throw new Error('injected compaction failure');
        });
      } catch {
        threw = true;
      }
      const afterChunks = Number(sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c);
      const afterUpdates = Number(sql.exec('SELECT COUNT(*) AS c FROM updates').one().c);
      return json({
        threw,
        rolledBack: threw && afterChunks === beforeChunks && afterUpdates === beforeUpdates,
        beforeChunks,
        afterChunks,
        beforeUpdates,
        afterUpdates,
        maxSeq,
      });
    }

    default:
      return fail(`unknown test op: ${op}`);
  }
}

export { handleTestOp };
