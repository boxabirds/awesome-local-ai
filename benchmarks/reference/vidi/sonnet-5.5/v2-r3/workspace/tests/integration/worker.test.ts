import { SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import worker, { type Env } from '../../src/worker/index';
import { WsClient, openSocket, settle, sleep, waitFor } from './helpers/ws-client';

const upgrade = { headers: { Upgrade: 'websocket' } };

describe('Worker routing', () => {
  it('TC-04: invalid id with Upgrade -> 400 and the namespace is never called', async () => {
    const idFromName = vi.fn();
    const env = { BOARD_ROOM: { idFromName, get: vi.fn() }, ASSETS: { fetch: vi.fn() } } as unknown as Env;
    const res = await worker.fetch(new Request('https://example.com/api/rooms/bad!id', upgrade), env);
    expect(res.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    const res2 = await SELF.fetch('https://example.com/api/rooms/bad!id', upgrade);
    expect(res2.status).toBe(400);
  });

  it('TC-05: valid id without Upgrade -> 426', async () => {
    const res = await SELF.fetch(`https://example.com/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: /b/<valid> serves index.html via the SPA fallback', async () => {
    const res = await SELF.fetch(`https://example.com/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13: the MAX_CONCURRENT_EDITORS + 1 th participant is accepted and edits reach everyone', async () => {
    const id = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) clients.push(await WsClient.connect(id));
    const last = clients[clients.length - 1];
    createSticky(last.doc, { x: 1, y: 2 });
    await waitFor(() => clients.every((c) => c.snapshot().length === 1), 'note on every client');
    await settle(clients);
    clients.forEach((c) => c.close());
  });

  it('TC-17: boards stay separate', async () => {
    const a = await WsClient.connect(newBoardId());
    const b = await WsClient.connect(newBoardId());
    const before = b.received.length;
    createSticky(a.doc, { x: 0, y: 0 });
    await sleep(300);
    expect(b.snapshot()).toHaveLength(0);
    expect(b.received.length).toBe(before);
    const late = await WsClient.connect(b.boardId);
    expect(late.snapshot()).toHaveLength(0);
    a.close();
    b.close();
    late.close();
    await openSocket(newBoardId()).then((ws) => ws.close());
  });
});
