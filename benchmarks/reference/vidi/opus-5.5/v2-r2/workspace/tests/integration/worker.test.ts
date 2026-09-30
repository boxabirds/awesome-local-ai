import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSticky } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { ORIGIN, TestClient, settle, waitForConvergence } from './ws-client';

const clients: TestClient[] = [];
async function join(boardId: string): Promise<TestClient> {
  const client = await TestClient.join(boardId);
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  vi.restoreAllMocks();
});

describe('Worker routing (sync.worker_entry)', () => {
  it('TC-04: rejects an invalid board id with 400 and never reaches a room', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const get = vi.spyOn(env.BOARD_ROOM, 'get');
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/bad!id`, { headers: { Upgrade: 'websocket' } });
    expect(response.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('TC-05: answers 426 to a valid board id without an Upgrade header', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${newBoardId()}`);
    expect(response.status).toBe(426);
    await response.body?.cancel();
  });

  it('TC-06: serves index.html for a board address (SPA fallback)', async () => {
    const response = await SELF.fetch(`${ORIGIN}/b/${newBoardId()}`, { headers: { Accept: 'text/html' } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<div id="root">');
  });

  it(`TC-13: accepts MAX_CONCURRENT_EDITORS + 1 (${MAX_CONCURRENT_EDITORS + 1}) participants; the last one edits normally`, async () => {
    const boardId = newBoardId();
    const participants: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) participants.push(await join(boardId));
    const last = participants[participants.length - 1]!;
    expect(last.closeEvent).toBeNull();
    const id = createSticky(last.doc, { x: 10, y: 20 });
    expect(id).not.toBe(false);
    await waitForConvergence(participants);
    for (const p of participants) expect(p.snapshot().map((n) => n.id)).toEqual([id]);
  });

  it('TC-17: changes on one board never reach another board', async () => {
    const room2 = newBoardId();
    const a = await join(newBoardId());
    const b = await join(room2);
    createSticky(a.doc, { x: 0, y: 0 });
    await settle();
    expect(b.updatesReceived()).toHaveLength(0);
    expect(b.snapshot()).toEqual([]);
    // Room 2's own document stays empty: a late joiner finds nothing.
    const c = await join(room2);
    expect(c.snapshot()).toEqual([]);
  });
});

describe('test-only storage hooks (TC-24 support)', () => {
  it.each(['compact', 'corrupt-snapshot', 'repair'])(
    'without TEST_HOOKS (production config) POST /__test/boards/:id/%s never reaches a room',
    async (action) => {
      expect(env.TEST_HOOKS).toBeUndefined();
      const get = vi.spyOn(env.BOARD_ROOM, 'get');
      const response = await SELF.fetch(`${ORIGIN}/__test/boards/${newBoardId()}/${action}`, { method: 'POST' });
      expect(get).not.toHaveBeenCalled();
      expect(response.headers.get('Content-Type') ?? '').not.toContain('application/json');
      expect(await response.text()).not.toContain('"hook"');
    },
  );
});
