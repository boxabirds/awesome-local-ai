/**
 * The board holds the number of people it is designed for, and one more (task 6.8,
 * TC-13). `MAX_CONCURRENT_EDITORS` is a capacity target, never a limit: a test reads
 * the constant rather than a literal, so raising it in config raises the expectation.
 *
 *   TC-13  the capacity of people plus one more all connect, all sync, and the last
 *          one to arrive can create, move and type for everybody else to see
 */

import { describe, expect, it, vi } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { WsClient } from './helpers/ws-client';

/** One more person than the board is designed for. */
const CROWD = MAX_CONCURRENT_EDITORS + 1;

function makeNote(client: WsClient, x: number, y: number, text: string): string {
  let id = '';
  client.transact((doc) => {
    const created = createSticky(doc, { x, y }, 'yellow');
    if (created === false) throw new Error('createSticky rejected the point');
    id = created;
    getStickyText(doc, id)?.insert(0, text);
  });
  return id;
}

describe(`${CROWD} people on one board (TC-13)`, () => {
  it('everybody is accepted, everybody gets the board, nobody is dropped', async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let index = 0; index < CROWD; index++) clients.push(await WsClient.connect(boardId));

    for (const client of clients) await client.waitForSync();
    expect(clients.every((client) => client.online)).toBe(true);

    // The first person's note reaches all the others.
    makeNote(clients[0] as WsClient, 0, 0, 'first');
    await vi.waitFor(() => {
      for (const client of clients) expect(client.snapshot()).toHaveLength(1);
    });

    // Nobody's socket was closed to make room: every connection is still open.
    for (const [index, client] of clients.entries()) {
      expect(client.rawSocket.isOpen, `client ${index} lost its socket`).toBe(true);
      expect(client.online, `client ${index} went offline`).toBe(true);
    }
  });

  it('the last person to arrive creates, moves, recolours, types and deletes for real', async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let index = 0; index < CROWD; index++) clients.push(await WsClient.connect(boardId));
    for (const client of clients) await client.waitForSync();
    const last = clients[CROWD - 1] as WsClient;
    const others = clients.slice(0, CROWD - 1);

    const id = makeNote(last, 10, 20, 'from the last one');
    await vi.waitFor(() => {
      for (const other of others) expect(other.snapshot().map((note) => note.text)).toEqual(['from the last one']);
    });

    last.transact((doc) => moveObject(doc, id, 777, -333));
    await vi.waitFor(() => {
      for (const other of others) expect(other.snapshot()[0]).toMatchObject({ x: 777, y: -333 });
    });

    last.transact((doc) => getStickyText(doc, id)?.insert(0, 'typed by the last one '));
    await vi.waitFor(() => {
      for (const other of others) {
        expect((other.snapshot()[0]?.text ?? '').startsWith('typed by the last one ')).toBe(true);
      }
    });

    last.transact((doc) => deleteObject(doc, id));
    await vi.waitFor(() => {
      for (const other of others) expect(other.snapshot()).toEqual([]);
    });
  });

  it('everybody edits at once and the board ends up the same for all of them', async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let index = 0; index < CROWD; index++) clients.push(await WsClient.connect(boardId));
    for (const client of clients) await client.waitForSync();

    // Each person creates a note and types into it, one after the other in the same
    // tick, so the updates are genuinely in flight together.
    const ids = clients.map((client, index) => makeNote(client, index * 40, 0, `person ${index}`));
    for (const [index, client] of clients.entries()) {
      const id = ids[index] as string;
      client.transact((doc) => getStickyText(doc, id)?.insert(0, 'edited '));
    }

    await vi.waitFor(() => {
      for (const client of clients) expect(client.snapshot()).toHaveLength(CROWD);
    });
    for (const client of clients) await client.settle(80);

    const [first, ...rest] = clients.map((client) => client.snapshot());
    for (const [index, snapshot] of rest.entries()) {
      expect(snapshot, `client ${index + 1} diverged`).toEqual(first);
    }
    for (let index = 0; index < CROWD; index++) {
      expect((first ?? []).some((note) => note.text === `edited person ${index}`)).toBe(true);
    }
  });

  it('that many clients are all upgraded and all get the document', async () => {
    const boardId = newBoardId();
    const first = await WsClient.connect(boardId);
    await first.waitForSync();
    makeNote(first, 0, 0, 'already here');
    await first.settle();

    const crowd: WsClient[] = [];
    for (let index = 0; index < CROWD; index++) crowd.push(await WsClient.connect(boardId));
    for (const client of crowd) await client.waitForSync();
    for (const client of crowd) {
      expect(client.rawSocket.isOpen).toBe(true);
      expect(client.snapshot()).toHaveLength(1);
    }
    expect(crowd.length).toBe(CROWD);
  });
});
