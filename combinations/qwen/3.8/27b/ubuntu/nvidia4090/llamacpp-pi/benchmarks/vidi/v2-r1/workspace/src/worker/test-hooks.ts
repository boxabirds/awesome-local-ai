// Test-only storage hooks (story 4, TC-24): storage corruption/repair, forced
// compaction and board seeding.
//
// These routes exist only when the worker registers them, which happens only
// when env.TEST_HOOKS === '1' (set in the e2e wrangler config, never in
// production config). The worker rewrites the request to
// `http://internal/__test/<op>` and calls the DO; this module handles it.
// In production the paths fall through to the asset server (SPA/404).

import * as Y from 'yjs';
import { firstRow, toUint8Array, type BoardStore } from './board-store';

export type TestHookOp = 'compact' | 'corrupt-snapshot' | 'repair' | 'reload' | 'seed';

export const TEST_HOOK_OPS: readonly TestHookOp[] = [
  'compact',
  'corrupt-snapshot',
  'repair',
  'reload',
  'seed',
];

export function isTestHookPath(url: URL): boolean {
  return url.pathname.startsWith('/__test/');
}

export function testHookOp(url: URL): TestHookOp | null {
  const op = url.pathname.slice('/__test/'.length);
  return (TEST_HOOK_OPS as readonly string[]).includes(op) ? (op as TestHookOp) : null;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** One deterministic byte that makes Yjs decoding throw: a varuint whose
 * continuation bit is set with no following byte ("Unexpected end of array"). */
const CORRUPT_SNAPSHOT_BYTES = new Uint8Array([0x80]);

export async function handleTestHook(
  req: Request,
  url: URL,
  storage: DurableObjectStorage,
  store: BoardStore,
  doc: Y.Doc | null,
): Promise<Response | null> {
  const op = testHookOp(url);
  if (op === null) return null;
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  switch (op) {
    case 'compact': {
      if (doc === null) return json(503, { ok: false, error: 'room not ready' });
      const compacted = store.compact(doc);
      return json(200, { ok: true, compacted });
    }
    case 'seed': {
      if (doc === null) return json(503, { ok: false, error: 'room not ready' });
      const update = new Uint8Array(await req.arrayBuffer());
      try {
        const scratch = new Y.Doc();
        Y.applyUpdate(scratch, update);
        scratch.destroy();
        Y.applyUpdate(doc, update, 'seed'); // stored + broadcast like any client update
      } catch {
        return json(400, { ok: false, error: 'invalid update' });
      }
      return json(200, { ok: true });
    }
    case 'corrupt-snapshot': {
      const sql = storage.sql;
      const row = firstRow<{ idx: number; data: ArrayBuffer }>(
        sql,
        'SELECT idx, data FROM snapshot_chunks ORDER BY idx LIMIT 1',
      );
      if (row === null) return json(409, { ok: false, error: 'no snapshot to corrupt' });
      const original = toUint8Array(row.data);
      storage.transactionSync(() => {
        sql.exec('CREATE TABLE IF NOT EXISTS __test_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
        sql.exec('DELETE FROM __test_backup');
        sql.exec('INSERT INTO __test_backup (idx, data) VALUES (?1, ?2)', row.idx, original);
        sql.exec('UPDATE snapshot_chunks SET data = ?1 WHERE idx = ?2', CORRUPT_SNAPSHOT_BYTES, row.idx);
      });
      return json(200, { ok: true });
    }
    case 'repair': {
      const sql = storage.sql;
      const backup = firstRow<{ idx: number; data: ArrayBuffer }>(sql, 'SELECT idx, data FROM __test_backup LIMIT 1');
      if (backup === null) return json(409, { ok: false, error: 'no backup to restore' });
      const original = toUint8Array(backup.data);
      storage.transactionSync(() => {
        sql.exec('UPDATE snapshot_chunks SET data = ?1 WHERE idx = ?2', original, backup.idx);
        sql.exec('DELETE FROM __test_backup');
      });
      return json(200, { ok: true });
    }
    default:
      return null;
  }
}
