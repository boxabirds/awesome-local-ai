
import { describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import worker, { type Env } from '../../src/worker/index';
import { connect, fetchWorker, openSocket, until, WsClient } from './ws-client';

const BASE = 'https://example.com';

describe('Worker routing', () => {
  it('TC-04: invalid board id → 400 and no room object is touched', async () => {
    const idFromName = vi.fn();
    const env = { BOARD_ROOM: { idFromName, get: vi.fn() }, ASSETS: { fetch: vi.fn() } } as unknown as Env;
    const res = await worker.fetch(
      new Request(`${BASE}/api/rooms/bad!id`, { headers: { Upgrade: 'websocket' } }), env,
    );
    expect(res.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    // and through the real entry point
    const real = await fetchWorker(`${BASE}/api/rooms/bad!id`, { headers: { Upgrade: 'websocket' } });
    expect(real.status).toBe(400);
  });

  it('TC-05: valid id without Upgrade → 426', async () => {
    const res = await fetchWorker(`${BASE}/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: /b/<id> serves the SPA index.html', async () => {
    const res = await fetchWorker(`${BASE}/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13: the (MAX_CONCURRENT_EDITORS + 1)th participant is accepted and edits normally', async () => {
    const board = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const ws = await openSocket(board); // openSocket throws unless the response is 101
      clients.push(new WsClient(ws));
    }
    await Promise.all(clients.map((c) => c.waitForSync()));
    const last = clients[clients.length - 1];
    const id = createSticky(last.doc, { x: 10, y: 20 });
    expect(id).toBeTruthy();
    await until(() => clients.every((c) => c.snapshot().length === 1), 5000, 'note on all clients');
    clients.forEach((c) => c.close());
  });

  it('TC-17: boards stay separate', async () => {
    const a = await connect(newBoardId());
    const b = await connect(newBoardId());
    createSticky(a.doc, { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.snapshot()).toHaveLength(0);
    expect(b.updateMessages).toBe(0);
    a.close();
    b.close();
  });
});
