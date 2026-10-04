/**
 * Integration tests for sync.worker_entry: the real Worker `fetch` handler
 * and Durable Object namespace in workerd (via SELF.fetch), no mocks.
 *
 * Covers TC-04 (invalid id → 404, no instance), TC-05 (missing Upgrade → 426),
 * TC-06 (SPA fallback), TC-13 (over-capacity joiners accepted),
 * TC-17 (boards stay separate).
 *
 * Story 5: rooms are no longer created implicitly by connecting — the test
 * fixtures initialize each board (the RPC the board API uses) first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import { openSocket, WsClient } from './ws-client';

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
  'Sec-WebSocket-Version': '13',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
};

/** Poll until `pred` returns truthy (workerd has no promise-based events). */
async function waitFor<T>(
  what: string,
  pred: () => T | false | null | undefined,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = pred();
    if (value) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function connectBoard(boardId: string): Promise<WsClient> {
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  await stub.initialize(); // story 5: create the board before connecting
  const ws = await openSocket((req) => stub.fetch(req), boardId);
  const client = new WsClient(ws);
  await client.waitForSync();
  return client;
}

describe('sync.worker_entry', () => {
  let idFromNameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The workerd stub's methods carry a `mock` property whose type
    // clashes with vitest's MockInstance; cast to a plain function shape.
    idFromNameSpy = vi.spyOn(
      env.BOARD_ROOM as unknown as { idFromName: (name: string) => unknown },
      'idFromName',
    );
  });

  afterEach(() => {
    idFromNameSpy.mockRestore();
  });

  it('TC-04: invalid board id with Upgrade → 404, no object instance looked up', async () => {
    // Story 5: story 3's 400 for malformed ids became 404 (unknown and
    // malformed are indistinguishable; nothing is leaked).
    const res = await SELF.fetch(
      new Request('http://localhost/api/rooms/bad!id', { headers: UPGRADE_HEADERS }),
    );
    expect(res.status).toBe(404);
    expect(idFromNameSpy).not.toHaveBeenCalled();
  });

  it('TC-05: valid board id without Upgrade header → 426', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${boardId}`),
    );
    expect(res.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> → 200 index.html (SPA fallback)', async () => {
    const boardId = newBoardId();
    // SPA fallback only applies to requests that accept HTML.
    const res = await SELF.fetch(
      new Request(`http://localhost/b/${boardId}`, {
        headers: { Accept: 'text/html' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="root"');
  });

  it(`TC-13: ${MAX_CONCURRENT_EDITORS + 1} participants are all accepted (over capacity not refused)`, async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      clients.push(await connectBoard(boardId));
    }
    // All 101s happened (connectBoard throws otherwise); now the last
    // joiner creates a note and every other client must receive it.
    const last = clients[clients.length - 1];
    const noteId = createSticky(last.doc, { x: 100, y: 100 });
    expect(noteId).toBeTruthy();

    for (const c of clients.slice(0, -1)) {
      await waitFor(`client to see note ${noteId}`, () =>
        c.boardSnapshot().some((n) => n.id === noteId) ? true : false,
      );
    }
    for (const c of clients) c.close();
  });

  it('TC-17: boards stay separate — updates never cross board objects', async () => {
    const boardA = newBoardId();
    const boardB = newBoardId();
    const a = await connectBoard(boardA);
    const b = await connectBoard(boardB);

    const noteId = createSticky(a.doc, { x: 10, y: 10 });
    expect(noteId).toBeTruthy();

    // Give any (incorrect) cross-board traffic a chance to arrive.
    await new Promise((r) => setTimeout(r, 500));

    const bNotes = b.boardSnapshot();
    expect(bNotes).toHaveLength(0);
    expect(b.receivedUpdates).toBe(0);
    expect(a.boardSnapshot().some((n) => n.id === noteId)).toBe(true);

    a.close();
    b.close();
  });
});
