import { describe, expect, it } from 'vitest';

import { SELF, env, listDurableObjectIds } from 'cloudflare:test';

import { createSticky } from '../../src/shared/board-model.js';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id.js';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.js';
import { connectClient, createBoard, eventually, syncedClient, requestRoom, type Client } from './ws-client.js';
import { sameBoard } from './random-ops.js';

/**
 * TC-04 to TC-06 (design "Worker entry and routing"): the Worker that stands in
 * front of the assets and in front of the rooms, driven with `SELF.fetch` — the
 * real `fetch` handler, the real assets binding and the real Durable Object
 * namespace, with nothing mocked.
 *
 * Rooms outlive a single test inside a project run (the Worker instance is shared
 * by the files), so these tests never assert "these are all the rooms": they
 * assert that *their* room exists, or that the set of rooms did not grow.
 */

const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  SELF.fetch(`http://localhost${path}`, { headers });

/**
 * The rooms that exist. `idFromName` is a runtime proxy a spy cannot wrap, so
 * "the namespace was never called" is measured at the thing a spy would only
 * claim: no Durable Object was created for that name.
 */
const roomIds = async (): Promise<string[]> =>
  (await listDurableObjectIds(env.BOARD_ROOM)).map((id) => id.toString());

/** The id a board name routes to. */
const idOf = (boardId: string): string => env.BOARD_ROOM.idFromName(boardId).toString();

/** The board another board's connections can never reach. */
const otherBoard = (): string => newBoardId();

describe('worker entry', () => {
  it('TC-04 refuses a board id that is not a board id, and creates no room', async () => {
    const before = await roomIds();

    // The case from the coverage table: `bad!id`, which is not base64url.
    // Story 5 made this a 404 rather than a 400: the answer to a malformed id and to
    // an unknown one is the same answer — there is no board here — and the client's
    // Board-not-found page is one page, not two (design "HTTP contract").
    const bad = await requestRoom('bad!id', true);
    expect(bad.status).toBe(404);
    expect(bad.webSocket).toBeFalsy();

    // The same answer for every other shape that is not 22 base64url characters.
    const malformed = [
      '', // /api/rooms/ — the route with no id at all
      'short',
      'a'.repeat(23), // one character too many
      'a'.repeat(21), // and one too few
      'bad!id',
      `${'a'.repeat(21)}!`, // right length, wrong alphabet
      '+'.repeat(22), // base64, not base64url
      `${'a'.repeat(21)}=`, // padding an unpadded encoding never carries
      '%2e%2e%2fx', // '.' and '/' encoded, so the URL parser cannot eat them
      '..%2Fx',
    ];
    for (const boardId of malformed) {
      const response = await requestRoom(boardId, true);
      expect(response.status, `board id ${JSON.stringify(boardId)}`).toBe(404);
      expect(response.webSocket).toBeFalsy();
    }

    // Not one of them created an object instance.
    expect(await roomIds()).toEqual(before);
  });

  it('TC-04 sends an id that is a board id on to that board’s room', async () => {
    const boardId = newBoardId();
    // Story 5: the board is created before it is joined, so this test still asks the
    // question it was built to ask — which room answers this address?
    expect(await createBoard(boardId)).toBe('created');
    const before = await roomIds();

    const response = await requestRoom(boardId, true);
    expect(response.status).toBe(101);
    expect(response.webSocket?.readyState).toBe(WebSocket.READY_STATE_OPEN);

    // The room that answered is the object this board name routes to — which is
    // what makes boards separate — and the request opened no other one.
    const ids = await roomIds();
    expect(ids.filter((id) => id === idOf(boardId))).toHaveLength(1);
    expect(ids.length).toBe(before.length);

    // The client end of the pair is ours to shut: workerd wants it accepted first.
    const socket = response.webSocket;
    if (socket !== undefined && socket !== null) {
      (socket as WebSocket & { accept(): void }).accept();
      socket.close();
    }
  });

  it('TC-05 answers a room request that never asked for an upgrade with a 426', async () => {
    const boardId = newBoardId();
    const before = await roomIds();

    const response = await requestRoom(boardId);
    expect(response.status).toBe(426);
    expect(response.webSocket).toBeFalsy();
    expect(await response.text()).toMatch(/websocket upgrade/i);

    // A plain GET to a room path is not a connection, so there is no room behind it.
    expect(await roomIds()).toEqual(before);
  });

  it('TC-05 gives two board ids two different rooms', async () => {
    const firstName = newBoardId();
    const secondName = newBoardId();
    expect(idOf(firstName)).not.toBe(idOf(secondName));

    const first = await connectClient(firstName);
    const second = await connectClient(secondName);
    const ids = await roomIds();
    expect(ids).toContain(idOf(firstName));
    expect(ids).toContain(idOf(secondName));

    // Each is talking to its own room: each got its own SyncStep1.
    await first.waitForSync();
    await second.waitForSync();

    first.close();
    second.close();
  });

  it('TC-06 serves the board page for /b/<valid>, and everything else it is asked for', async () => {
    const boardId = newBoardId();
    const before = await roomIds();

    const index = await get('/');
    expect(index.status).toBe(200);
    expect(index.headers.get('Content-Type')).toContain('text/html');
    expect(await index.text()).toContain('<div id="root">');

    // The SPA fallback: a deep link to a board is the same page, which reads the
    // board id out of the path itself.
    const deep = await get(`/b/${boardId}`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<div id="root">');
    expect(BOARD_ID_PATTERN.test(boardId)).toBe(true);

    // And the script the page loads is served too: adding a Worker did not take
    // the assets away.
    const src = /<script[^>]*src="([^"]+)"/.exec(await get(`/b/${boardId}`).then((r) => r.text()))?.[1];
    expect(src, 'the page loads a script').toBeTruthy();
    const asset = await get(src ?? '/nope.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('function');

    // None of this opened a room.
    expect(await roomIds()).toEqual(before);
  });

  it('TC-06 never lets a path traversal out of the room route', async () => {
    const before = await roomIds();

    // A literal `..` is resolved by the URL parser before the Worker sees the
    // path, so `/api/rooms/../x` is not a room path at all — it is `/api/x`, which
    // is not a route either and gets the client. What matters is that it opens no
    // room, and it opens none; the encoded form, which the parser cannot collapse,
    // is refused with a 404 (TC-04).
    const response = await get('/api/rooms/../x', { Upgrade: 'websocket' });
    expect(response.webSocket).toBeFalsy();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
    expect(await roomIds()).toEqual(before);
  });

  it('TC-13 accepts a room full of people, and the one over capacity, and edits work', async () => {
    const boardId = newBoardId();
    const clients: Client[] = [];

    // MAX_CONCURRENT_EDITORS people, then one more. Nobody is turned away: the
    // capacity number is a design and test target, not a limit anyone enforces.
    for (let index = 0; index < MAX_CONCURRENT_EDITORS + 1; index++) {
      const client = await syncedClient(boardId);
      expect(
        client.ws.readyState,
        `person ${index + 1} was not upgraded`,
      ).toBe(WebSocket.READY_STATE_OPEN);
      clients.push(client);
    }
    expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS + 1);

    // The one who pushed the board over capacity edits like anyone else, and the
    // change reaches every other screen.
    const latecomer = clients[clients.length - 1] as Client;
    createSticky(latecomer.doc, { x: 77, y: 77 });
    const others = clients.slice(0, -1);
    await eventually(
      () => {
        for (const [index, client] of others.entries()) {
          if (client.snapshot().length !== 1) {
            throw new Error(`screen ${index + 1} shows ${client.snapshot().length} notes`);
          }
        }
      },
      { what: 'every other screen shows the note' },
    );
    expect(others.every((client) => sameBoard(client.snapshot(), latecomer.snapshot()))).toBe(true);

    clients.forEach((client) => client.close());
  });

  it('TC-17 keeps a change on one board from ever reaching another board', async () => {
    const first = newBoardId();
    const second = otherBoard();

    const a = await syncedClient(first);
    const b = await syncedClient(second);
    const seen = b.received.length;

    createSticky(a.doc, { x: 1, y: 1 });

    // Nothing arrives on the other board, and nothing is on it.
    await b.expectNothing(500);
    expect(b.snapshot()).toEqual([]);

    // The second room is a different document, not just a quiet one: someone who
    // joins it now still sees nothing of the first board.
    const lateSecond = await syncedClient(second);
    expect(lateSecond.snapshot()).toEqual([]);

    // And the first room is unaffected by all that silence next door.
    const lateFirst = await syncedClient(first);
    await eventually(() => expect(lateFirst.snapshot()).toHaveLength(1), {
      what: 'the first board still holds its note',
    });
    expect(b.snapshot()).toEqual([]);
    expect(lateSecond.snapshot()).toEqual([]);

    a.close();
    b.close();
    lateFirst.close();
    lateSecond.close();
    void seen;
  });
});
