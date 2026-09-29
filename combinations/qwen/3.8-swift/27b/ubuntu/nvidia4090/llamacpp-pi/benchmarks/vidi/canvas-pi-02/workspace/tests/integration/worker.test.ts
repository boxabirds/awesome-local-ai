// Story 3, sync.worker_entry integration tests: the real Worker fetch handler
// and Durable Object namespace in workerd, hit via SELF.fetch. No mocks.
//
// TC-04, TC-05, TC-06 (routing), TC-13 (over capacity not refused),
// TC-17 (boards stay separate).

import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { RoomClient, createNote } from './ws-client';

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
};

describe('sync.worker_entry', () => {
  it('TC-04: invalid board id with Upgrade -> 404, no object instance created', async () => {
    // Story 5 contract: malformed ids get 404 (not 400) — no distinction
    // from unknown ids, nothing leaked, and the DO namespace is untouched.
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const resp = await SELF.fetch(
      new Request('http://localhost/api/rooms/bad!id', { headers: UPGRADE_HEADERS }),
    );
    expect(resp.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('TC-05: valid board id without Upgrade header -> 426', async () => {
    const resp = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${newBoardId()}`),
    );
    expect(resp.status).toBe(426);
  });

  it('TC-06: GET /b/<valid id> -> 200 index.html (SPA fallback)', async () => {
    const resp = await SELF.fetch(
      new Request(`http://localhost/b/${newBoardId()}`),
    );
    expect(resp.status).toBe(200);
    const body = await resp.text();
    expect(body).toContain('<div id="root">');
  });

  it(`TC-13: ${MAX_CONCURRENT_EDITORS + 1} clients are all accepted (over capacity is not refused)`, async () => {
    const boardId = newBoardId();
    const clients: RoomClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = await RoomClient.connect(boardId);
      await client.waitForSync();
      clients.push(client);
    }
    // The last (over-capacity) client creates a note; it reaches all others.
    const last = clients[clients.length - 1];
    const id = createNote(last, 40, 40);
    for (const client of clients.slice(0, -1)) {
      await waitForNote(client, id);
    }
    clients.forEach((c) => c.close());
  });

  it('TC-17: changes do not cross boards (isolation)', async () => {
    const room1 = newBoardId();
    const room2 = newBoardId();
    const a = await RoomClient.connect(room1);
    await a.waitForSync();
    const b = await RoomClient.connect(room2);
    await b.waitForSync();

    const id = createNote(a, 10, 10);

    // B sees nothing and its room's doc stays empty.
    expect(b.notes).toHaveLength(0);
    expect(b.updateMessages()).toHaveLength(0);

    // A is fine and has its note.
    expect(a.notes.map((n) => n.id)).toContain(id);

    a.close();
    b.close();
  });

  it('TC-24 (production): /_test/ hooks are absent without TEST_HOOKS', async () => {
    // This suite runs with wrangler.jsonc (production), which never sets
    // TEST_HOOKS, so the hooks must fall through to the SPA assets.
    const boardId = newBoardId();
    const state = await SELF.fetch(
      new Request(`http://localhost/_test/${boardId}/state`),
    );
    expect(state.status).toBe(200);
    expect(await state.text()).toContain('<div id="root">');

    const corrupt = await SELF.fetch(
      new Request(`http://localhost/_test/${boardId}/corrupt-snapshot`, {
        method: 'POST',
      }),
    );
    // Static assets answer POST with a non-hook status (405), never JSON.
    expect(corrupt.status).toBe(405);
    expect((corrupt.headers.get('Content-Type') ?? '').includes('application/json')).toBe(false);
  });
});

async function waitForNote(client: RoomClient, id: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(client.notes.map((n) => n.id)).toContain(id);
    },
    { timeout: 5000 },
  );
}
