import { SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/worker/index';
import type { Env } from '../../src/worker/index';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { WsClient, waitFor } from './ws-client';

describe('worker entry', () => {
  it('TC-04: invalid id with Upgrade -> 400 and no room object is touched', async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const env = { BOARD_ROOM: { idFromName, get }, ASSETS: { fetch: vi.fn() } } as unknown as Env;
    const res = await worker.fetch(
      new Request('https://example.com/api/rooms/bad!id', { headers: { Upgrade: 'websocket' } }),
      env,
    );
    expect(res.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    const real = await SELF.fetch('https://example.com/api/rooms/bad!id', { headers: { Upgrade: 'websocket' } });
    expect(real.status).toBe(400);
  });

  it('TC-05: valid id without Upgrade -> 426', async () => {
    const res = await SELF.fetch(`https://example.com/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06: /b/<id> serves index.html (SPA fallback)', async () => {
    const res = await SELF.fetch(`https://example.com/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13: the (MAX_CONCURRENT_EDITORS + 1)th participant is accepted and can edit', async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const c = await WsClient.connect(boardId); // connect throws unless 101
      await c.waitForSync();
      clients.push(c);
    }
    const last = clients[clients.length - 1];
    const id = createSticky(last.doc, { x: 0, y: 0 });
    expect(id).toBeTruthy();
    for (const other of clients.slice(0, -1)) {
      await waitFor(() => other.snapshotJson === last.snapshotJson, 'note to reach everyone');
    }
    clients.forEach((c) => c.close());
  });

  it('TC-17: boards are isolated', async () => {
    const a = await WsClient.connect(newBoardId());
    const b = await WsClient.connect(newBoardId());
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    createSticky(a.doc, { x: 1, y: 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(b.updateMessages).toHaveLength(0);
    expect(JSON.parse(b.snapshotJson)).toEqual([]);
    expect(JSON.parse(a.snapshotJson)).toHaveLength(1);
    a.close();
    b.close();
  });
});
