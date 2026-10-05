/**
 * Integration tests for the Worker's front door (sync.worker_entry).
 *
 * These run inside workerd against the Worker and the Durable Object class the product
 * actually ships, with real WebSocket connections and no mocks. What they hold the
 * Worker to is small but load-bearing: an address that is not a board is refused before
 * anything is created for it; a board connection is only ever a connection; the app is
 * served at a board address; more people than the design expects are still let in; and
 * two boards never meet.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  close,
  converge,
  createBoard,
  createClient,
  createNote,
  fetchBoard,
  fetchPath,
  noteById,
  onlyNote,
  settle,
  upgradeHeaders,
  waitForSync,
  type BoardClient,
} from './helpers/ws-client';

/** Addresses a test tries when it wants to be refused. */
const BAD_IDS = ['bad!id', 'short', 'a'.repeat(23), '../x', 'a'.repeat(21), ''];

describe('Worker routing', () => {
  it('refuses a board connection whose address is not a board address (TC-04)', async () => {
    // The namespace is the thing that would create a room for an address, so counting
    // its use is how the test knows the Worker stopped first: an address that is not a
    // board must not be able to make rooms, not even empty ones.
    //
    // It is a 404, and that is the whole of story 5's change to this route: an address
    // that is nonsense and an address that leads nowhere get the same answer, because the
    // difference between them tells a stranger whether a link was nearly right.
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    try {
      for (const id of BAD_IDS) {
        const response = await fetchBoard(encodeURIComponent(id), { headers: upgradeHeaders() });
        expect(`${id}: ${response.status}`).toBe(`${id}: 404`);
        await response.text();
      }
      expect(idFromName).not.toHaveBeenCalled();
    } finally {
      idFromName.mockRestore();
    }
  });

  it('still connects a well-formed address (negative control for TC-04)', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const id = await createBoard();
    try {
      const response = await fetchBoard(id, { headers: upgradeHeaders() });
      expect(response.status).toBe(101);
      expect(idFromName).toHaveBeenCalledWith(id);
      close(response.webSocket);
    } finally {
      idFromName.mockRestore();
    }
  });

  it('answers a board address that is not asking for a WebSocket with 426 (TC-05)', async () => {
    // 426 says "this only works over a WebSocket", which is true, rather than lying
    // about an address that is perfectly well formed.
    const id = await createBoard();
    const plain = await fetchBoard(id);
    expect(plain.status).toBe(426);
    await plain.text();

    // A request that is both a bad address and not a connection is a bad address
    // first: the Worker has to say so instead of inviting a retry.
    const bad = await fetchBoard('not-a-board-address!', { headers: upgradeHeaders() });
    expect(bad.status).toBe(404);
    await bad.text();
  });

  it('serves the app at a board address (TC-06)', async () => {
    // This is the whole of "open the link and be on the board": the address is not a
    // file, and the Worker has to hand over the app anyway.
    const response = await fetchPath(`/b/${newBoardId()}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('id="root"');
  });

  it('serves the app at the site root too', async () => {
    const root = await fetchPath('/');
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('id="root"');
  });

  it('lets more people in than the design expected, and syncs them (TC-13)', async () => {
    // MAX_CONCURRENT_EDITORS is what the board is designed and tested for, not a
    // limit; the person who turns up late is still let in and still gets the board.
    const id = await createBoard();
    const clients: BoardClient[] = [];
    try {
      for (let index = 0; index < MAX_CONCURRENT_EDITORS + 1; index += 1) {
        clients.push(await connectBoard(id));
      }
      expect(clients.every((client) => client.open)).toBe(true);

      const last = clients[clients.length - 1];
      const note = createNote(last);
      await converge(clients);
      for (const client of clients) {
        expect(noteById(client, note)?.id).toBe(note);
      }
      expect(onlyNote(last).id).toBe(note);
    } finally {
      for (const client of clients) client.close();
    }
  }, 30_000);

  it('keeps two boards apart (TC-17)', async () => {
    // Isolation is the reason one board is one object: a person on another board must
    // not see a note, a presence state, or anything else at all.
    const first = await connectBoard(await createBoard());
    const second = await connectBoard(await createBoard());
    try {
      const notes = second.snapshot().length;
      const frames = second.log.length;

      createNote(first, { x: 20, y: 30 });
      await settle();

      expect(second.snapshot()).toHaveLength(notes);
      expect(second.log).toHaveLength(frames);
      expect(second.awareness.getStates().has(first.clientId())).toBe(false);
    } finally {
      first.close();
      second.close();
    }
  });
});

/**
 * Connect a client and wait for it to be synced. Written here rather than using the
 * helper's `connect` so that a refusal names the address it was for.
 */
async function connectBoard(boardId: string): Promise<BoardClient> {
  const response = await fetchBoard(boardId, { headers: upgradeHeaders() });
  const socket = response.webSocket;
  if (response.status !== 101 || !socket) {
    throw new Error(`board ${boardId} answered ${response.status}, not a connection`);
  }
  const client = createClient(boardId, socket);
  await waitForSync(client);
  return client;
}
