import { SELF, env, listDurableObjectIds } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSticky } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { TestClient, createBoardId, openSocket, waitFor } from './ws-client';

const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  vi.restoreAllMocks();
});

async function connect(boardId: string): Promise<TestClient> {
  const c = await TestClient.connect(boardId);
  clients.push(c);
  return c;
}

describe('Worker routing (sync.worker_entry)', () => {
  it('TC-04: invalid board id with Upgrade → 404 (400 before story 5) and no room object is created', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const before = (await listDurableObjectIds(env.BOARD_ROOM)).length;
    const res = await SELF.fetch('http://vidi6.test/api/rooms/bad!id', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    expect((await listDurableObjectIds(env.BOARD_ROOM)).length).toBe(before);
  });

  it('TC-04 control: the idFromName spy does observe valid room requests', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const boardId = await createBoardId();
    await connect(boardId);
    expect(idFromName).toHaveBeenCalledWith(boardId);
  });

  it('TC-04: path traversal and wrong-length ids → 404 (400 before story 5)', async () => {
    for (const bad of ['..%2Fx', 'A'.repeat(21), 'A'.repeat(23)]) {
      const res = await SELF.fetch(`http://vidi6.test/api/rooms/${bad}`, { headers: { Upgrade: 'websocket' } });
      expect(res.status, bad).toBe(404);
    }
  });

  it('TC-05: valid id without Upgrade → 426', async () => {
    const res = await SELF.fetch(`http://vidi6.test/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: /b/<valid id> → 200 index.html (SPA fallback)', async () => {
    const res = await SELF.fetch(`http://vidi6.test/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 participants are all accepted; the last one edits for everyone', async () => {
    const boardId = await createBoardId();
    const all: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) all.push(await connect(boardId));
    const last = all[all.length - 1];
    const id = createSticky(last.doc, { x: 10, y: 20 });
    for (const other of all.slice(0, -1)) {
      await waitFor(() => other.snapshot().some((n) => n.id === id), 'note at every participant');
    }
    expect(all.every((c) => c.closeCode === null)).toBe(true);
  });

  it('TC-13: the upgrade for the extra participant answers 101', async () => {
    const boardId = await createBoardId();
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) await connect(boardId);
    const { status, ws } = await openSocket(boardId);
    expect(status).toBe(101);
    ws?.close();
  });

  it('TC-17: boards stay separate', async () => {
    const boardB = await createBoardId();
    const a = await connect(await createBoardId());
    const b = await connect(boardB);
    const receivedBefore = b.received.length;
    createSticky(a.doc, { x: 0, y: 0 });
    // A's own round trip proves the room processed A's update.
    await a.barrier();
    await b.barrier();
    expect(b.received.length).toBe(receivedBefore + 1); // only B's own barrier
    expect(b.snapshot()).toEqual([]);
    // A fresh participant on B's board also sees an empty board.
    const b2 = await connect(boardB);
    expect(b2.snapshot()).toEqual([]);
  });
});
