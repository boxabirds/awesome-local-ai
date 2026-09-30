// TEST-ONLY routes on a board room, present only when the `TEST_HOOKS` variable
// is set to `'1'` - which the production configuration never does (see
// `wrangler.jsonc`, which defines no such variable, and the e2e test that asserts
// the route is absent without it).
//
// They exist because the honest way to test a damaged board is to damage a real
// row in real storage and then watch the real load path refuse it. Doing that
// from a test would mean either reaching into a Durable Object from outside
// (which no client can do) or pretending with a fake storage; a route on the room
// itself uses the same SQL and the same load code as production.
//
//   POST /__test/corrupt-snapshot
//     Compact the room's document so a snapshot exists, save a copy of chunk 0 in
//     `test_hook_backup`, overwrite it with unusable bytes of the same length,
//     then make the room read its storage again - which is exactly what a wake or
//     a retry does. The room lands in `load-failed` and closes its sockets with
//     CLOSE_BOARD_LOAD_FAILED, so a connected page shows the load-failure message.
//
//   POST /__test/repair-snapshot
//     Put the saved chunk back and read the storage again, so a board recovers
//     without anyone reloading the page.
//
//   GET /__test/diagnostics
//     Read the room's diagnostics - which state it is in, how much of the board is
//     in the log and how far the stored snapshot reaches - so an end-to-end test
//     can see compaction happen while the board is being used. Reads nothing and
//     changes nothing.
//
// Both answer with the room's diagnostics as JSON, which is what the tests assert.

import type { RoomDiagnostics } from './board-room';
import type { RoomState } from './room-state';
import type { BoardStore } from './board-store';
import type * as Y from 'yjs';

/** What the hooks need, assembled by the room at the call site. */
export interface TestHookTarget {
  /** `true` only when `TEST_HOOKS` is `'1'`; every hook refuses to run without it. */
  enabled: boolean;
  storage: DurableObjectStorage;
  store: BoardStore;
  /** The room's document, when it has one (the hook compacts it). */
  doc(): Y.Doc | null;
  /** The room's own reload path (a wake, or the retry after a repair). */
  reload(): RoomState;
  diagnostics(): RoomDiagnostics;
}

const BACKUP_TABLE = 'test_hook_backup';

const CREATE_BACKUP_TABLE = `CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (key TEXT PRIMARY KEY, data BLOB NOT NULL)`;

/** Unusable bytes of the same length, from a seeded generator (so a failure reproduces). */
function unusableBytes(bytes: Uint8Array): Uint8Array {
  let state = 0x2545f491;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < out.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = (state >>> 8) & 0xff;
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle a `/__test/...` request on a room. Returns 404 when the hooks are not
 * enabled, so a production deployment answers like any unknown path.
 */
export function handleTestHook(target: TestHookTarget, request: Request): Response {
  const action = new URL(request.url).pathname.slice('/__test/'.length);
  if (!target.enabled) {
    return new Response('Not found', { status: 404 });
  }

  const { storage, store } = target;

  if (action === 'diagnostics') {
    if (request.method !== 'GET') return json({ error: 'diagnostics is a GET' }, 405);
    return json(target.diagnostics());
  }
  if (request.method !== 'POST') {
    return json({ error: 'damaging storage is a POST' }, 405);
  }
  storage.sql.exec(CREATE_BACKUP_TABLE);

  if (action === 'corrupt-snapshot') {
    const doc = target.diagnostics().loaded ? target.doc() : null;
    if (doc === null) return json({ error: 'the room holds no document to compact' }, 409);

    // A snapshot to damage: compact now rather than make the test write 500 rows.
    if (store.snapshotThrough() === 0) store.compactIfNeeded(doc, { force: true });
    const original = [...storage.sql.exec(`SELECT data FROM snapshot_chunks WHERE idx = 0`)][0];
    if (original === undefined) return json({ error: 'no snapshot chunk to damage' }, 409);
    const before = new Uint8Array(original.data as ArrayBuffer);

    storage.sql.exec(
      `INSERT OR REPLACE INTO ${BACKUP_TABLE} (key, data) VALUES (?1, ?2)`,
      'snapshot_chunk_0',
      before,
    );
    storage.sql.exec(`UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`, unusableBytes(before));

    // Read the storage back the way a wake does: this is the path that must refuse
    // to serve a board it cannot read.
    const state = target.reload();
    return json({ ...target.diagnostics(), corrupted: true, state });
  }

  if (action === 'repair-snapshot') {
    const saved = [...storage.sql.exec(`SELECT data FROM ${BACKUP_TABLE} WHERE key = ?1`, 'snapshot_chunk_0')][0];
    if (saved === undefined) return json({ error: 'nothing was damaged on this board' }, 409);
    const good = new Uint8Array(saved.data as ArrayBuffer);
    storage.sql.exec(`UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`, good);
    storage.sql.exec(`DELETE FROM ${BACKUP_TABLE} WHERE key = ?1`, 'snapshot_chunk_0');
    const state = target.reload();
    return json({ ...target.diagnostics(), repaired: true, state });
  }

  return new Response('Not found', { status: 404 });
}
