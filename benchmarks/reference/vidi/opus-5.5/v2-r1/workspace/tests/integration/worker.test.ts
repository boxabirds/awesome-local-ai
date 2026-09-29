import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createSticky } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import worker from '../../src/worker/index';
import { TestClient, roomUrl, createBoardId } from './ws-client';

const open: TestClient[] = [];
async function connect(boardId: string) {
  const client = await TestClient.connect(boardId);
  open.push(client);
  return client;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

describe('sync.worker_entry routing', () => {
  it('TC-04 rejects an invalid board id with 404 (story 5; was 400) without touching the room namespace', async () => {
    const calls: string[] = [];
    // The real namespace, wrapped to record every use.
    const spied = new Proxy(env.BOARD_ROOM, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return value.apply(target, args);
        };
      },
    });
    for (const bad of ['bad!id', '..%2Fx', 'short', `${newBoardId()}A`, `${newBoardId()}/extra`]) {
      const res = await worker.fetch(
        new Request(roomUrl(bad), { headers: { Upgrade: 'websocket' } }),
        { ...env, BOARD_ROOM: spied },
      );
      expect(res.status, bad).toBe(404);
    }
    expect(calls).toEqual([]);

    // Same through the deployed entry point.
    const res = await SELF.fetch(roomUrl('bad!id'), { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
  });

  it('TC-05 answers a valid board id without an Upgrade header with 426', async () => {
    const res = await SELF.fetch(roomUrl(newBoardId()));
    expect(res.status).toBe(426);
  });

  it('TC-06 serves index.html for a board address (SPA fallback)', async () => {
    const res = await SELF.fetch(`http://example.com/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13 accepts MAX_CONCURRENT_EDITORS + 1 sockets and the last one edits for everyone', async () => {
    const boardId = await createBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) clients.push(await connect(boardId));
    for (const c of clients) expect(c.status).toBe(101);

    const last = clients[clients.length - 1];
    const id = createSticky(last.doc, { x: 10, y: 20 });
    expect(id).toBeTruthy();
    for (const c of clients.slice(0, -1)) {
      await expect.poll(() => c.snapshot().map((n) => n.id)).toEqual([id]);
    }
  });

  it('TC-17 keeps boards separate', async () => {
    const room1 = await createBoardId();
    const room2 = await createBoardId();
    const a = await connect(room1);
    const a2 = await connect(room1);
    const b = await connect(room2);
    const receivedBefore = b.received.length;

    createSticky(a.doc, { x: 0, y: 0 });
    // Once another client on room1 has it, the room has broadcast it.
    await expect.poll(() => a2.snapshot().length).toBe(1);
    await b.roundTrip();

    expect(b.updatesReceived).toBe(0);
    expect(b.received.length).toBe(receivedBefore + 1); // only the round-trip reply
    expect(b.snapshot()).toEqual([]);
  });
});
