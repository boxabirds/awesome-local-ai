import { SELF, env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/worker/index';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { TestClient, converged, createdBoardId, openSocket, quiet } from './ws-client';

describe('sync.worker_entry', () => {
  it('TC-04 an invalid board id is rejected (404 since story 5) before any room is touched', async () => {
    const res = await SELF.fetch('http://vidi6.test/api/rooms/bad!id', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);

    // The same handler with a spied namespace: no object id is ever derived.
    const idFromName = vi.fn(env.BOARD_ROOM.idFromName.bind(env.BOARD_ROOM));
    const get = vi.fn(env.BOARD_ROOM.get.bind(env.BOARD_ROOM));
    const spiedEnv = { ...env, BOARD_ROOM: { ...env.BOARD_ROOM, idFromName, get } } as unknown as typeof env;
    for (const bad of ['bad!id', 'short', '..%2Fx', '']) {
      const r = await worker.fetch(
        new Request(`http://vidi6.test/api/rooms/${bad}`, { headers: { Upgrade: 'websocket' } }),
        spiedEnv,
      );
      expect(r.status, bad).toBe(404);
    }
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('TC-05 a valid board id without a WebSocket upgrade gets 426', async () => {
    const res = await SELF.fetch(`http://vidi6.test/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06 /b/<id> serves the client (SPA fallback)', async () => {
    const res = await SELF.fetch(`http://vidi6.test/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13 one more than MAX_CONCURRENT_EDITORS can join and edit; nobody is refused', async () => {
    const boardId = await createdBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await TestClient.connect(boardId));

    const { status, ws } = await openSocket(boardId);
    expect(status).toBe(101);
    ws?.close();

    const extra = await TestClient.connect(boardId);
    clients.push(extra);
    expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS + 1);
    const id = createSticky(extra.doc, { x: 0, y: 0 });
    const notes = await converged(clients);
    expect(notes.map((n) => n.id)).toEqual([id]);
    clients.forEach((c) => c.close());
  });

  it('TC-17 changes on one board never reach another board', async () => {
    const room2 = await createdBoardId();
    const a = await TestClient.connect(await createdBoardId());
    const b = await TestClient.connect(room2);
    const updatesBefore = b.count('update');
    createSticky(a.doc, { x: 10, y: 10 });
    await quiet();
    expect(b.count('update')).toBe(updatesBefore);
    expect(b.notes()).toEqual([]);

    // A late joiner in room 2 gets that room's whole document: still empty.
    const observer = await TestClient.connect(room2);
    expect(observer.notes()).toEqual([]);
    [a, b, observer].forEach((c) => c.close());
  });
});

describe('test-only storage hooks', () => {
  it('without TEST_HOOKS (production config) /__test/* is just the static client', async () => {
    expect(env.TEST_HOOKS).toBeUndefined();
    for (const action of ['seed', 'compact', 'corrupt-snapshot', 'repair']) {
      const url = `http://vidi6.test/__test/boards/${newBoardId()}/${action}`;
      // POST reaches the static assets, which do not serve POST; nothing touches a board.
      const post = await SELF.fetch(url, { method: 'POST' });
      expect(post.status, action).not.toBe(200);
      expect(await post.text()).not.toBe('ok');
      const get = await SELF.fetch(url);
      expect(get.headers.get('content-type'), action).toContain('text/html');
      expect(await get.text()).toContain('<div id="root">');
    }
  });
});
