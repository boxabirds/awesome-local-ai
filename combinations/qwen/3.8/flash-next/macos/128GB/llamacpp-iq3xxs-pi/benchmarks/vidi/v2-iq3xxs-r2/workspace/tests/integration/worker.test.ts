import { env, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { TestClient, connectClients, createBoardRoom, disconnectClients } from './helpers/ws-client';

/**
 * The Worker's own routing (`sync.worker_entry`), run inside workerd against the real
 * `fetch` handler, the real assets binding and the real Durable Object namespace.
 */

const ROOM_HEADERS = { Upgrade: 'websocket', Connection: 'Upgrade' };

/** Ask the Worker for a room socket without going through the test client. */
function requestRoom(path: string, headers: Record<string, string> = ROOM_HEADERS) {
  return SELF.fetch(`http://vc.test${path}`, { headers });
}

/** A short settle window, only ever used to prove that something does *not* arrive. */
async function settle(ms = 300): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('worker routing (TC-04 to TC-06, TC-13, TC-17)', () => {
  // Story 5 (`share.not_found`) turned story 3's 400 into the same 404 an unknown board
  // gets: a bad address says "no such board" and nothing else, so nothing is revealed.
  it('TC-04 rejects a malformed board id with 404 and never asks for the object', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    for (const path of ['/api/rooms/bad!id', '/api/rooms/', '/api/rooms/short', '/api/rooms/AAAAAAAAAAAAAAAAAAAAAAAA']) {
      const response = await requestRoom(path);
      expect(response.status, path).toBe(404);
    }
    expect(isValidBoardId('bad!id')).toBe(false);
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  it('never lets a path-traversal address reach a room', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    // The runtime normalises `..` before the handler sees the path, so this is the
    // client again, and no room object was created on the way.
    const response = await requestRoom('/api/rooms/../../etc/passwd');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  it('rejects an id that a percent-encoding smuggles a path into', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const response = await requestRoom(`/api/rooms/${newBoardId()}%2Fadmin`);
    expect(response.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  it('TC-05 answers a valid board address with no Upgrade with 426', async () => {
    const boardId = newBoardId();
    const plain = await SELF.fetch(`http://vc.test/api/rooms/${boardId}`);
    expect(plain.status).toBe(426);
    // A request that mentions the header without upgrading is still not a socket.
    const odd = await requestRoom(`/api/rooms/${boardId}`, { Upgrade: 'HTTPS' });
    expect(odd.status).toBe(426);
  });

  it('TC-06 serves the client for a board address and leaves it on the same address', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://vc.test/b/${boardId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('id="root"');
    // The SPA fallback never redirects, so the address in the bar stays the shareable one.
    expect(response.url).toBe(`http://vc.test/b/${boardId}`);
    // The root document is served too, and neither counts as a room request.
    const root = await SELF.fetch('http://vc.test/');
    expect(root.status).toBe(200);
  });

  it('upgrades a valid board address and hands the socket to that board', async () => {
    const boardId = newBoardId();
    // Story 5: only a board that exists answers a socket (TC-09 covers the other case).
    await createBoardRoom(boardId);
    const response = await requestRoom(`/api/rooms/${boardId}`, {
      Upgrade: 'WebSocket',
      Connection: 'upgrade',
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (socket) {
      socket.accept();
      socket.close();
    }
  });

  it('TC-13 accepts one more person than MAX_CONCURRENT_EDITORS and syncs them normally', async () => {
    const boardId = newBoardId();
    const count = MAX_CONCURRENT_EDITORS + 1;
    const clients = await connectClients(boardId, count);
    try {
      // Nothing refuses the sixth socket: every one of them is a 101 with a live socket.
      expect(clients).toHaveLength(count);
      for (const client of clients) expect(client.isOpen).toBe(true);

      initDoc(clients[0]!.doc);
      const id = createSticky(clients[0]!.doc, { x: 20, y: 20 });
      if (typeof id !== 'string') throw new Error('createSticky failed');
      const last = clients[clients.length - 1]!;
      initDoc(last.doc);
      const lateId = createSticky(last.doc, { x: 80, y: 80 });
      if (typeof lateId !== 'string') throw new Error('createSticky failed');

      // The over-capacity person edits like everyone else, and everyone sees it.
      for (const client of clients) {
        await client.waitUntil(
          'both notes on every one of the six clients',
          () => client.notes().length === 2,
        );
      }
      const ids = clients.map((client) => client.notes().map((note) => note.id).join(','));
      expect(new Set(ids).size).toBe(1);
    } finally {
      disconnectClients(clients);
    }
  });

  it('TC-17 keeps two boards separate: traffic on one never reaches the other', async () => {
    const [boardA, boardB] = [newBoardId(), newBoardId()];
    const [onA, onB] = await Promise.all([TestClient.connect(boardA), TestClient.connect(boardB)]);
    await settle();
    const beforeB = onB.frames.length;
    try {
      initDoc(onA.doc);
      createSticky(onA.doc, { x: 10, y: 10 });
      await onA.waitUntil('the note on its own board', () => onA.notes().length === 1);
      await settle();
      expect(onB.notes()).toHaveLength(0);
      expect(onB.frames.length).toBe(beforeB);
      // And the second board's room object stayed empty, not merely unseen: somebody
      // joining it later gets an empty board back.
      const rejoin = await TestClient.connect(boardB);
      try {
        await settle();
        expect(rejoin.notes()).toHaveLength(0);
      } finally {
        disconnectClients([rejoin]);
      }
    } finally {
      disconnectClients([onA, onB]);
    }
  });
});
