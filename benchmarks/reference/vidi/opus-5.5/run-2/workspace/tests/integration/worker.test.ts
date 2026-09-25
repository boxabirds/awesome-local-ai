import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/worker/index';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import { TestClient, roomUrl, sleep, waitConverged } from './helpers/ws-client';

const QUIET_MS = 100;
let open: TestClient[] = [];

async function join(boardId: string): Promise<TestClient> {
  const c = await TestClient.connect(boardId);
  open.push(c);
  await c.waitForSync();
  return c;
}

afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
  vi.restoreAllMocks();
});

describe('Worker routing (sync.worker_entry)', () => {
  it('TC-04 rejects an invalid board id with 400 and never touches the namespace', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const get = vi.spyOn(env.BOARD_ROOM, 'get');
    const req = new Request(roomUrl('bad!id'), { headers: { Upgrade: 'websocket' } });
    const direct = await worker.fetch(req, env);
    expect(direct.status).toBe(400);
    const viaRuntime = await SELF.fetch(roomUrl('bad!id'), { headers: { Upgrade: 'websocket' } });
    expect(viaRuntime.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('TC-05 answers 426 for a valid board id without an Upgrade header', async () => {
    const res = await SELF.fetch(roomUrl(newBoardId()));
    expect(res.status).toBe(426);
  });

  it('TC-06 serves index.html for /b/<id> (single-page-application fallback)', async () => {
    const res = await SELF.fetch(`http://vidi6.test/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });

  it(`TC-13 accepts MAX_CONCURRENT_EDITORS + 1 (${MAX_CONCURRENT_EDITORS + 1}) sockets and the last one's note reaches everyone`, async () => {
    const boardId = newBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) clients.push(await join(boardId));
    const last = clients[clients.length - 1]!;
    const id = createSticky(last.doc, { x: 10, y: 20 });
    await waitConverged(clients);
    for (const c of clients) expect(c.snapshot().map((n) => n.id)).toEqual([id]);
  });

  it('TC-17 keeps boards separate', async () => {
    const board2 = newBoardId();
    const a = await join(newBoardId());
    const b = await join(board2);
    const before = b.received.length;
    createSticky(a.doc, { x: 0, y: 0 });
    await sleep(QUIET_MS);
    expect(b.received.length).toBe(before);
    expect(b.snapshot()).toEqual([]);
    // The room of board 2 holds no note either: a fresh joiner receives an empty board.
    const c = await join(board2);
    expect(c.snapshot()).toEqual([]);
  });
});
