import { env, exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import worker from '../../src/worker/index';
import { WsClient, converge, waitFor } from './ws-client';

describe('worker routing', () => {
  it('TC-04: invalid id with Upgrade → 400 and no room is touched', async () => {
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const res = await exports.default.fetch('http://example.com/api/rooms/bad!id', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('TC-04b: the handler itself never calls the namespace for an invalid id', async () => {
    const idFromName = vi.fn();
    const fake = { BOARD_ROOM: { idFromName }, ASSETS: env.ASSETS } as unknown as Parameters<typeof worker.fetch>[1];
    const res = await worker.fetch(new Request('http://example.com/api/rooms/bad!id', { headers: { Upgrade: 'websocket' } }), fake);
    expect(res.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
  });

  it('TC-05: valid id without Upgrade → 426', async () => {
    const res = await exports.default.fetch(`http://example.com/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: /b/<id> serves the SPA index.html', async () => {
    const res = await exports.default.fetch(`http://example.com/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 sockets are all accepted and edits reach everyone', async () => {
    const id = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const c = await WsClient.connect(id); // throws unless the upgrade answers 101
      clients.push(c);
    }
    const last = clients[clients.length - 1];
    const noteId = createSticky(last.doc, { x: 10, y: 20 });
    await waitFor(() => clients.every((c) => c.snapshot().some((n) => n.id === noteId)), 'note on all clients');
    await converge(clients);
  });

  it('TC-17: boards stay separate', async () => {
    const a = await WsClient.connect(newBoardId());
    const b = await WsClient.connect(newBoardId());
    const before = b.received.length;
    createSticky(a.doc, { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 300));
    expect(b.received.length).toBe(before);
    expect(b.snapshot()).toHaveLength(0);
  });
});
