import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { createSticky } from '../../src/shared/board-model.ts';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.ts';
import { TestClient, tick } from './helpers/ws-client.ts';

function upgradeHeaders(): HeadersInit {
  return { Upgrade: 'websocket', Connection: 'Upgrade' };
}

// TC-04 (negative): an invalid board id is answered 404 and is short-circuited in
// the Worker BEFORE any Durable Object is touched. Story 5 deliberately changed
// this answer from story 3's 400: a malformed code and a code nobody ever created
// get the same reply (`404 {"error":"not_found"}`), so probing links learns
// nothing about what a real code looks like. The room itself still only ever
// returns 426, 404 or 101.
describe('TC-04 invalid board id', () => {
  it('rejects with 404 without reaching a room', async () => {
    const res = await SELF.fetch('http://placeholder/api/rooms/bad!id', {
      headers: upgradeHeaders(),
    });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeFalsy();
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects an empty id without creating a room', async () => {
    const res = await SELF.fetch('http://placeholder/api/rooms/', { headers: upgradeHeaders() });
    // Empty id => route regex does not match => falls through to assets (SPA),
    // not a room call. A 404/200 from assets still means no room was created.
    expect(res.webSocket).toBeFalsy();
  });
});

// TC-05: a valid id WITHOUT an Upgrade header returns 426 (no socket).
it('TC-05 valid id without Upgrade returns 426', async () => {
  const id = newBoardId();
  const res = await SELF.fetch(`http://placeholder/api/rooms/${id}`);
  expect(res.status).toBe(426);
  expect(res.webSocket).toBeFalsy();
});

// TC-06: SPA fallback — any /b/<id> path returns the built index.html.
it('TC-06 GET /b/<valid> returns index.html (SPA fallback)', async () => {
  const id = newBoardId();
  const res = await SELF.fetch(`http://placeholder/b/${id}`);
  expect(res.status).toBe(200);
  const ct = res.headers.get('content-type') || '';
  expect(ct).toMatch(/text\/html/i);
  const body = await res.text();
  expect(body).toMatch(/<div id="root">/i);
});

// TC-13 (over capacity, negative): MAX+1 sockets on one board are all accepted,
// and a note created by the last reaches everyone. Capacity is never enforced.
it('TC-13 an over-capacity participant is never refused', async () => {
  const id = newBoardId();
  const n = MAX_CONCURRENT_EDITORS + 1;
  const clients: TestClient[] = [];
  for (let i = 0; i < n; i++) clients.push(await TestClient.connect(id));
  for (const c of clients) expect(c.open).toBe(true);
  // Sync everyone to the (empty) room.
  await Promise.all(clients.map((c) => c.waitForSync()));

  const last = clients[clients.length - 1];
  const noteId = createSticky(last.doc, { x: 42, y: 24 });
  expect(noteId).toBeTruthy();

  // Every *other* client sees the new note within the latency budget.
  for (const c of clients) {
    if (c === last) continue;
    await c.waitFor(() => c.snapshot().some((s) => s.id === noteId), 1000, 'note reaches peer');
  }
  for (const c of clients) c.close();
});

// TC-17 (isolation, negative): a change on one board never appears on another.
it('TC-17 updates do not cross boards', async () => {
  const room1 = newBoardId();
  const room2 = newBoardId();

  const a = await TestClient.connect(room1);
  const b = await TestClient.connect(room2);
  await a.waitForSync();
  await b.waitForSync();

  createSticky(a.doc, { x: 10, y: 20 });
  await a.waitFor(() => a.snapshot().length === 1, 1000, 'a has its note');

  // Let the event loop run; room2 must not receive anything.
  await Promise.all([tick(40), tick(40)]);

  expect(b.snapshot()).toHaveLength(0);
  // room2's doc stays empty even after another round trip.
  await b.waitForSync();
  expect(b.snapshot()).toHaveLength(0);

  a.close();
  b.close();
});
