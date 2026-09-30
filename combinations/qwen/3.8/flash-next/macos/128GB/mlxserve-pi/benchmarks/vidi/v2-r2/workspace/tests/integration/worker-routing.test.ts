import { describe, expect, it } from 'vitest';
import { SELF, env, listDurableObjectIds } from 'cloudflare:test';
import { createSticky, type StickySnapshot } from '../../src/shared/board-model';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { TestClient } from './helpers/ws-client';

// These exercise the real Worker `fetch` handler and the real Durable Object
// namespace in workerd via `SELF.fetch` — no mocks anywhere in the path.
describe('worker routing (TC-04 to TC-06, TC-13, TC-17)', () => {
  it('TC-04 refuses an invalid board id (400) without ever touching the namespace', async () => {
    const before = await listDurableObjectIds(env.BOARD_ROOM);
    const res = await SELF.fetch('http://localhost/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(400);
    // Validating before the namespace means no object was addressed at all.
    const after = await listDurableObjectIds(env.BOARD_ROOM);
    expect(after.length).toBe(before.length);
  });

  it('TC-05 refuses a valid board id with no WebSocket upgrade (426)', async () => {
    const res = await SELF.fetch(`http://localhost/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
    expect(res.headers.get('Upgrade')).toBe('websocket');
  });

  it('TC-06 serves the SPA for /b/<valid>', async () => {
    const res = await SELF.fetch(`http://localhost/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13 accepts over-capacity joins and still relays to everyone', async () => {
    const boardId = newBoardId();
    // One socket per allowed editor, plus one more: the boundary is a design
    // target, never a limit the room enforces.
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      clients.push(await TestClient.connect(boardId));
    }
    await Promise.all(clients.map((c) => c.waitForSync()));

    const last = clients[clients.length - 1]!;
    const id = createSticky(last.doc, { x: 20, y: 40 });
    expect(id).not.toBe('');

    for (const c of clients.slice(0, -1)) {
      await expect.poll(() => c.snapshot().some((n) => n.id === id)).toBe(true);
    }
    for (const c of clients) c.close();
  });

  it('TC-17 keeps boards isolated from each other', async () => {
    const boardA = newBoardId();
    const boardB = newBoardId();
    const a = await TestClient.connect(boardA);
    const b = await TestClient.connect(boardB);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    a.clearLog();
    b.clearLog();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await expect.poll(() => a.snapshot().some((n) => n.id === id)).toBe(true);

    // Nothing crossed over: B never received an update and its board stays empty.
    expect(b.updateCount).toBe(0);
    expect(b.snapshot()).toHaveLength(0);
    const roomB = await readRoomSnapshot(boardB);
    expect(roomB).toHaveLength(0);

    a.close();
    b.close();
  });

  it('routes each board to a distinct object id (isolation at the namespace)', async () => {
    const boardA = newBoardId();
    const boardB = newBoardId();
    const idA = env.BOARD_ROOM.idFromName(boardA);
    expect(isValidBoardId(boardA)).toBe(true);
    // Same name -> same id; different names -> different ids.
    expect(String(env.BOARD_ROOM.idFromName(boardA))).toBe(String(idA));
    expect(String(env.BOARD_ROOM.idFromName(boardB))).not.toBe(String(idA));
  });
});

// Read a room's own document straight from the Durable Object, to prove
// isolation is at the object, not just the connected sockets.
async function readRoomSnapshot(boardId: string): Promise<readonly StickySnapshot[]> {
  const { runInDurableObject } = await import('cloudflare:test');
  const { snapshot } = await import('../../src/shared/board-model');
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  // `doc` is private to the class but present at runtime; read it in place.
  const run = runInDurableObject as unknown as (
    stub: unknown,
    cb: (instance: { doc: import('yjs').Doc }) => readonly StickySnapshot[],
  ) => Promise<readonly StickySnapshot[]>;
  return run(stub, (room) => snapshot(room.doc));
}
