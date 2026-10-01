import { SELF, env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import worker, { type Env } from '../../src/worker';

declare global {
  namespace Cloudflare {
    interface Env { ASSETS: Fetcher }
  }
}
import { ORIGIN, WsClient, eventually, roomUrl } from './helpers/ws-client';

const upgrade = { Upgrade: 'websocket' };

describe('worker routing', () => {
  it('TC-04: invalid id with Upgrade -> 400 and no object instance is touched', async () => {
    const idFromName = vi.fn();
    const fakeEnv = { BOARD_ROOM: { idFromName, get: vi.fn() }, ASSETS: env.ASSETS } as unknown as Env;
    const res = await worker.fetch(new Request(`${ORIGIN}/api/rooms/bad!id`, { headers: upgrade }), fakeEnv);
    expect(res.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect((await SELF.fetch(roomUrl('bad!id'), { headers: upgrade })).status).toBe(400);
  });

  it('TC-05: valid id without Upgrade -> 426', async () => {
    const res = await SELF.fetch(roomUrl(newBoardId()));
    expect(res.status).toBe(426);
  });

  it('TC-06: /b/<id> serves index.html (SPA fallback)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/b/${newBoardId()}`, { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('TC-13: a participant beyond MAX_CONCURRENT_EDITORS is accepted and can edit', async () => {
    const id = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const c = await WsClient.connect(id);
      await c.waitForSync();
      clients.push(c);
    }
    const last = clients[clients.length - 1];
    const noteId = createSticky(last.doc, { x: 10, y: 10 });
    await eventually(() => clients.every((c) => c.snapshot().some((n) => n.id === noteId)));
    clients.forEach((c) => c.close());
  });

  it('test hook routes are absent unless TEST_HOOKS is set', async () => {
    const id = newBoardId();
    const asset = new Response('spa');
    const fakeEnv = { BOARD_ROOM: (env as unknown as Env).BOARD_ROOM, ASSETS: { fetch: async () => asset } } as unknown as Env;
    const res = await worker.fetch(new Request(`${ORIGIN}/__test/boards/${id}/corrupt-snapshot`, { method: 'POST' }), fakeEnv);
    expect(res).toBe(asset);
    const hooked = { ...fakeEnv, TEST_HOOKS: '1' } as Env;
    expect((await worker.fetch(new Request(`${ORIGIN}/__test/boards/${id}/repair`, { method: 'POST' }), hooked)).status).toBe(500);
  });

  it('TC-17: boards stay separate', async () => {
    const a = await WsClient.connect(newBoardId());
    const b = await WsClient.connect(newBoardId());
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    createSticky(a.doc, { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 300));
    expect(b.snapshot()).toHaveLength(0);
    expect(b.updatesReceived).toBe(0);
    a.close();
    b.close();
  });
});
