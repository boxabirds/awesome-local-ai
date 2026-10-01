import { SELF, env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import worker from '../../src/worker/index';
import { WsClient, openSocket, settle, waitUntil } from './helpers/ws-client';

const upgrade = { headers: { Upgrade: 'websocket' } };

describe('worker entry (sync.worker_entry)', () => {
  it('TC-04 invalid board id → 404 and the namespace is never touched', async () => {
    const idFromName = vi.fn();
    const fakeEnv = { BOARD_ROOM: { idFromName, get: vi.fn() }, ASSETS: env.ASSETS } as never;
    const res = await worker.fetch(new Request('http://example.com/api/rooms/bad!id', upgrade), fakeEnv);
    expect(res.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    const real = await SELF.fetch('http://example.com/api/rooms/bad!id', upgrade);
    expect(real.status).toBe(404);
  });

  it('TC-05 valid id without Upgrade → 426', async () => {
    const res = await SELF.fetch(`http://example.com/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06 /b/<valid> serves index.html (SPA fallback)', async () => {
    const res = await SELF.fetch(`http://example.com/b/${newBoardId()}`, { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13 MAX_CONCURRENT_EDITORS + 1 sockets are all accepted and see edits', async () => {
    const id = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) clients.push(await WsClient.connect(id));
    await Promise.all(clients.map((c) => c.waitForSync()));
    const last = clients[clients.length - 1];
    createSticky(last.doc, { x: 10, y: 10 });
    await waitUntil(() => clients.every((c) => c.snapshot().length === 1), 10_000, 'note reaching everyone');
    for (const c of clients) c.close();
  });

  it('TC-17 boards stay separate', async () => {
    const a = await WsClient.connect(newBoardId());
    const b = await WsClient.connect(newBoardId());
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    createSticky(a.doc, { x: 0, y: 0 });
    await settle(300);
    expect(b.snapshot()).toHaveLength(0);
    expect(b.updatesReceived).toBe(0);
    expect(Y.encodeStateVector(b.doc).length).toBeLessThanOrEqual(1);
    a.close();
    b.close();
  });

  it('opening a socket directly returns 101', async () => {
    const ws = await openSocket(newBoardId());
    ws.close(1000);
  });
});
