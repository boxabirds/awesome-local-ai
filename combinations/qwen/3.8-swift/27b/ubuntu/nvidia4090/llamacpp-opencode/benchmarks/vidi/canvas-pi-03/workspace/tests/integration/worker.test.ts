/**
 * Worker routing integration tests (sync.worker_entry). TC-04/TC-05 hit the
 * real `fetch` handler with a spy env to assert the object namespace is never
 * touched for rejected routes. TC-06 uses `SELF.fetch` for the SPA fallback
 * (assets path, no DO). TC-13/TC-17 exercise the room via direct instances
 * (real WebSockets + Yjs) to verify capacity and board isolation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import worker from 'src/worker/index';
import { newBoardId } from 'src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from 'src/shared/config';
import { createSticky } from 'src/shared/board-model';
import { connectRoomClient, settleBoards, type RoomClient } from './helpers/ws-client';

// Local workerd's DO isolate overflows at ~11 live BoardRoom objects; evict
// idle boards between tests so the live count stays under the limit.
afterEach(async () => {
  await settleBoards();
});

interface SpyResult {
  res: Response;
  idFromName: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

async function fetchViaWorker(url: string, headers: Record<string, string> = {}): Promise<SpyResult> {
  const idFromName = vi.fn(() => 'object-id');
  const get = vi.fn(() => ({ fetch: vi.fn().mockResolvedValue(new Response('do')) }));
  const env = {
    BOARD_ROOM: { idFromName, get },
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('assets')) },
  };
  const res = await worker.fetch(
    new Request(`http://localhost${url}`, { headers }),
    env as never,
  );
  return { res, idFromName, get };
}

describe('sync.worker_entry routing', () => {
  it('TC-04: invalid board id with Upgrade → 400, object namespace never called', async () => {
    const out = await fetchViaWorker('/api/rooms/bad!id', {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
    });
    expect(out.res.status).toBe(400);
    expect(out.idFromName).not.toHaveBeenCalled();
    expect(out.get).not.toHaveBeenCalled();
  });

  it('TC-05: valid id without Upgrade header → 426, object not created', async () => {
    const id = newBoardId();
    const out = await fetchViaWorker(`/api/rooms/${id}`);
    expect(out.res.status).toBe(426);
    expect(out.res.headers.get('Upgrade')).toBe('websocket');
    // No object is created: neither idFromName nor get is touched.
    expect(out.idFromName).not.toHaveBeenCalled();
    expect(out.get).not.toHaveBeenCalled();
  });

  it('TC-06: GET /b/<valid> → 200 index.html (SPA fallback) via the real worker', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/b/${id}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">');
    expect(body.toLowerCase()).toContain('<!doctype html>');
  });

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 sockets all accepted; note reaches all others', async () => {
    const room = newBoardId();
    const n = MAX_CONCURRENT_EDITORS + 1;
    const clients: RoomClient[] = [];
    for (let i = 0; i < n; i++) clients.push(await connectRoomClient(room));
    for (const c of clients) {
      expect(c.isConnected()).toBe(true);
      await c.waitForSync();
    }

    const last = clients[clients.length - 1];
    createSticky(last.doc, { x: 0, y: 0 });

    for (const c of clients) {
      await c.waitFor(() => c.snapshot().length === 1);
    }
    const ids = new Set(clients.map((c) => c.snapshot()[0].id));
    expect(ids.size).toBe(1);
    for (const c of clients) await c.close();
  });

  it('TC-17: updates do not cross boards (isolation)', async () => {
    const room1 = newBoardId();
    const room2 = newBoardId();
    const a = await connectRoomClient(room1);
    const b = await connectRoomClient(room2);
    await a.waitForSync();
    await b.waitForSync();

    createSticky(a.doc, { x: 5, y: 5 });
    await a.waitFor(() => a.snapshot().length === 1);

    // B is on a different room: receives nothing, doc stays empty.
    await new Promise((r) => setTimeout(r, 200));
    expect(b.snapshot().length).toBe(0);
    await a.close();    await b.close();  });
});
