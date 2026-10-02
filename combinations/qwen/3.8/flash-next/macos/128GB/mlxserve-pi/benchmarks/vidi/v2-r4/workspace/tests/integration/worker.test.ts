/**
 * Integration tests for the Worker's front door: which request goes where.
 *
 * Real Worker, real Durable Object, real WebSocket upgrade, real built assets,
 * real Yjs — nothing here is mocked. `TC-nn` ids are the ones the story's
 * acceptance list uses.
 *
 * TC-04 invalid board id -> 400, no room opened
 * TC-05 valid id without an upgrade -> 426, no room opened
 * TC-06 a board page is served from the assets
 * TC-13 a sixth person on a board is accepted like anybody else
 * TC-17 two board ids are two rooms, and they never hear each other
 */
import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';

import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { TestClient } from './ws-client';

/** A board id of the right shape, fixed so the addresses in the log read well. */
const BOARD = 'Ys9f1L2mN3pQ4rS5tU6vWx';

describe('worker routing', () => {
  it('TC-04: an unknown board address is answered with 400 and opens no room', async () => {
    const opened = vi.spyOn(env.BOARD_ROOM, 'idFromName');

    const response = await SELF.fetch('https://example.com/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });

    expect(response.status).toBe(400);
    expect(response.webSocket).toBeNull();
    // The address was refused before the room was even looked up: no object for
    // `bad!id` is ever named, let alone created.
    expect(opened).not.toHaveBeenCalled();
  });

  it('TC-05: a valid board address without an upgrade is answered with 426', async () => {
    const opened = vi.spyOn(env.BOARD_ROOM, 'idFromName');

    const response = await SELF.fetch(`https://example.com/api/rooms/${BOARD}`);

    expect(response.status).toBe(426);
    expect(response.webSocket).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });

  it('TC-06: a board page comes from the assets', async () => {
    const response = await SELF.fetch(`https://example.com/b/${BOARD}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root"');
  });

  it('TC-13: a board keeps accepting people past MAX_CONCURRENT_EDITORS', async () => {
    const boardId = newBoardId();
    const people = MAX_CONCURRENT_EDITORS + 1;

    const clients: TestClient[] = [];
    for (let i = 0; i < people; i++) {
      const { client, response } = await TestClient.connect(boardId);
      // Nobody is turned away: the capacity setting is a design and test target,
      // not a limit.
      expect(response.status).toBe(101);
      clients.push(client);
    }
    await Promise.all(clients.map((client) => client.waitForSync()));

    // The last person in is over the design target, and is treated like anybody
    // else: their change reaches everyone else on the board.
    const overCapacity = clients[people - 1]!;
    const id = createSticky(overCapacity.doc, { x: 30, y: 40 });
    expect(id).not.toBe('');
    for (const client of clients.slice(0, people - 1)) {
      await client.waitForDoc((doc) => snapshot(doc).some((note) => note.id === id));
    }
  });

  it('TC-17: two board addresses are two rooms that never hear each other', async () => {
    const mine = newBoardId();
    const theirs = newBoardId();
    // Different addresses, so different room objects — this is the whole basis of
    // "a change on one board cannot be seen on another".
    expect(String(env.BOARD_ROOM.idFromName(mine))).not.toBe(
      String(env.BOARD_ROOM.idFromName(theirs)),
    );

    const here = await TestClient.connect(mine);
    const there = await TestClient.connect(theirs);
    expect(here.response.status).toBe(101);
    expect(there.response.status).toBe(101);
    await here.client.waitForSync();
    await there.client.waitForSync();
    here.client.clearLog();
    there.client.clearLog();

    // The person over there changes their board.
    createSticky(there.client.doc, { x: 10, y: 20 });

    // Nothing arrives on this board, and nothing on it changes.
    await here.client.quiet();
    expect(here.client.received).toHaveLength(0);
    expect(snapshot(here.client.doc)).toEqual([]);
    expect(snapshot(there.client.doc)).toHaveLength(1);
  });
});
