// Test-only HTTP hooks on the BoardRoom object (persist.room, persist.client_status).
//
// These routes exist so the integration and e2e tests can put a board into a
// state that a user can never produce by clicking — a damaged snapshot, an
// injected SQL failure, a pre-compacted log — and then verify what the room
// does with it. They are reachable ONLY when `env.TEST_HOOKS === '1'`, which is
// set in the test wrangler environment (`--env test`) and in `npm run
// workers:test`, never in the production config; the worker entry returns a
// plain SPA 404/asset response for these paths otherwise (verified by
// tests/e2e/production-hooks.spec.ts).
//
// Routes (path as seen by the room, forwarded from /__test/rooms/:id/... by
// src/worker/index.ts):
//
//   GET  state                 → lifecycle + bookkeeping snapshot
//   POST seed                  → body: raw Yjs update bytes, loaded as fixture
//                                state (not stored, not broadcast)
//   POST compact               → run the real compaction rewrite once
//   POST inject-failure        → {"reads": n, "writes": n, "select": sql}
//   POST corrupt-snapshot      → save + damage snapshot chunk 0
//   POST repair                → restore chunk 0 and reload the document

import type { BoardRoom } from './board-room';

/** Storage key under which the pristine chunk 0 is parked while damaged. */
const SAVED_CHUNK_KEY = '__test:saved-snapshot-chunk-0';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The last path segment of the hook path (`.../state` → `state`). */
function hookName(pathname: string): string {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}

/** Snapshot of the current storage + room state (what `GET state` returns). */
function stateOf(room: BoardRoom): Record<string, unknown> {
  const snapshot = room.storeForTest ? room.storeForTest.dumpSnapshot() : [];
  return {
    ...room.testState(),
    // Every socket is hibernated once the idle timer fired (design: the
    // `state` field must be able to report "hibernating").
    hibernating: room.webSocketCountForTest() === 0,
    chunkCount: snapshot.length,
    snapshotBytes: snapshot.reduce((total, chunk) => total + chunk.bytes, 0),
    log: room.storeForTest ? room.storeForTest.dumpLog() : null,
    snapshot,
    quarantined: room.storeForTest ? room.storeForTest.dumpQuarantined() : null,
  };
}

export async function handleRoomTestRequest(room: BoardRoom, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hook = hookName(url.pathname);
  const method = request.method.toUpperCase();

  if (hook === 'state' && method === 'GET') return json(stateOf(room));

  if (hook === 'seed' && method === 'POST') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const ok = room.seedDocumentForTest(bytes);
    return json({ ok, ...stateOf(room) }, ok ? 200 : 500);
  }

  if (hook === 'compact' && method === 'POST') {
    const ok = room.compactForTest();
    return json({ ok, ...stateOf(room) }, ok ? 200 : 500);
  }

  if (hook === 'inject-failure' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      reads?: number;
      writes?: number;
      select?: string;
    };
    room.armFailuresForTest(body.reads ?? 0, body.writes ?? 0, body.select);
    return json({ ok: true, armed: { reads: body.reads ?? 0, writes: body.writes ?? 0 } });
  }

  if (hook === 'corrupt-snapshot' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { chunk?: number };
    const chunkIndex = body.chunk ?? 0;
    const store = room.storeForTest;
    if (store === null) return json({ ok: false, error: 'no store (board not loaded)' }, 409);
    const chunks = store.dumpSnapshot();
    if (!chunks.some((chunk) => chunk.idx === chunkIndex)) {
      return json({ ok: false, error: 'no snapshot to corrupt (compact first)' }, 409);
    }
    // Park the pristine bytes out of the SQL tables (so `repair` can restore
    // them), then overwrite the chunk with same-length garbage: the encoded
    // length prefix stays intact, which is exactly the "unreadable snapshot"
    // case TC-10/TC-24 exercise.
    const original = store.readSnapshotChunk(chunkIndex);
    if (original === null) return json({ ok: false, error: 'chunk vanished' }, 409);
    await room.kvForTest.put(SAVED_CHUNK_KEY, original.slice());
    const damaged = new Uint8Array(original.length);
    for (let i = 0; i < damaged.length; i += 1) damaged[i] = (original[i] + 163) % 256;
    store.overwriteSnapshotChunk(chunkIndex, damaged);
    // A damaged document must not stay "served" from the old in-memory copy:
    // drop it, so the next connection sees the failure and answers 4500.
    room.reloadForTest();
    return json({ ok: true, ...stateOf(room) });
  }

  if (hook === 'repair' && method === 'POST') {
    const store = room.storeForTest;
    const saved = (await room.kvForTest.get(SAVED_CHUNK_KEY)) as Uint8Array | undefined;
    if (store === null || saved === undefined) return json({ ok: false, error: 'nothing to repair' }, 409);
    store.overwriteSnapshotChunk(0, saved.slice());
    await room.kvForTest.delete(SAVED_CHUNK_KEY);
    // Recover WITHOUT a new object: reload the document from the repaired
    // storage, so the very next socket gets the board back (TC-16 / TC-24).
    room.reloadForTest();
    return json({ ok: true, ...stateOf(room) });
  }

  return json({ ok: false, error: `unknown test hook: ${hook}` }, 404);
}
