// Story 3, `sync.worker_entry`: the Worker routes a board's socket to that
// board's Durable Object and serves the client for every other address.
//
// Test numbers are the design's coverage table (TC-04, TC-05, TC-06, TC-13,
// TC-17). What the Worker itself decides, and therefore what is tested here:
//   * the address shape is checked before the namespace is touched, so a
//     malformed address cannot create a Durable Object (TC-04) — with no
//     sign-in until story 14 the id is the only thing guarding a board;
//   * a board address without a WebSocket upgrade is answered, not served
//     (TC-05);
//   * every other address, including a board page URL, is the built client
//     (TC-06);
//   * more people than the design capacity are accepted and can work (TC-13):
//     nothing here counts participants, MAX_CONCURRENT_EDITORS is a design and
//     test target and never a limit (live.over_capacity);
//   * each address is its own Durable Object, which is what keeps one board's
//     notes and broadcasts off every other board (TC-17, live.isolation).
import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { ROOM_PATH_PREFIX } from '../../src/shared/routes';
import { STATUS_NOT_FOUND, STATUS_UPGRADE_REQUIRED } from '../../src/shared/protocol';
import { connectClients, createRoom, inspectRoom, settle } from './helpers/ws-client';

/** Ask the app for a path, as a browser or a provider would. */
const get = (path: string, init?: RequestInit): Promise<Response> =>
  SELF.fetch(`http://localhost${path}`, init);

/**
 * Ask the app for a board's socket. The socket is accepted on the way out,
 * because workerd refuses even a close on a socket nobody accepted.
 */
const upgrade = async (boardId: string, header: string = 'websocket'): Promise<Response> => {
  const response = await get(`${ROOM_PATH_PREFIX}${boardId}`, { headers: { Upgrade: header } });
  response.webSocket?.accept();
  return response;
};

/**
 * Spy on the namespace so a test can say "no board was looked up". The spy
 * forwards to the real function, so routing still works.
 */
function spyOnLookup(): { names: string[]; ids: string[] } {
  const names: string[] = [];
  const ids: string[] = [];
  const original = env.BOARD_ROOM.idFromName.bind(env.BOARD_ROOM);
  vi.spyOn(env.BOARD_ROOM, 'idFromName').mockImplementation((name: string) => {
    const id = original(name);
    names.push(name);
    ids.push(id.toString());
    return id;
  });
  return { names, ids };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TC-04, TC-05, TC-06: the address before the object', () => {
  it('TC-04 takes a well-formed address with an upgrade and gives a socket', async () => {
    const boardId = newBoardId();
    await createRoom(boardId); // story 5: a board must exist before a socket opens
    expect(boardId).toMatch(BOARD_ID_PATTERN);
    const response = await upgrade(boardId);
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    response.webSocket?.close();
  });

  it('TC-04 refuses a malformed address without looking a board up', async () => {
    const { names } = spyOnLookup();
    for (const bad of ['bad!id', '', 'short', 'a'.repeat(21), 'a'.repeat(23), '+'.repeat(22)]) {
      const response = await upgrade(bad);
      // Story 5: a malformed socket address is now a 404, answered exactly like
      // an unknown board, so a probe learns nothing about the id's shape.
      expect(response.status).toBe(STATUS_NOT_FOUND);
      expect(response.webSocket ?? null).toBeNull();
      expect(await response.text()).toContain('board');
    }
    // TC-04 must not happen: an invalid id must not create an object instance
    expect(names).toEqual([]);
  });

  it('TC-04 a path-traversal address never reaches a board', async () => {
    const { names } = spyOnLookup();
    // `..` segments are resolved by the URL itself, so they cannot name a
    // board; the percent-encoded forms stay in the path and fail the shape.
    for (const bad of ['../x', '..%2Fx', '%2e%2e/x', '../../etc/passwd']) {
      const response = await upgrade(bad);
      expect([STATUS_NOT_FOUND, 200]).toContain(response.status);
      expect(response.webSocket ?? null).toBeNull();
    }
    expect(names).toEqual([]);
  });

  it('TC-05 answers a board address that is not an upgrade with 426', async () => {
    const boardId = newBoardId();
    const response = await get(`${ROOM_PATH_PREFIX}${boardId}`);
    expect(response.status).toBe(STATUS_UPGRADE_REQUIRED);
    expect(response.webSocket ?? null).toBeNull();
    expect(await response.text()).toContain('WebSocket');
  });

  it('TC-05 accepts the Upgrade header in any case and with padding', async () => {
    for (const header of ['websocket', 'WebSocket', '  Websocket  ']) {
      const boardId = newBoardId();
      await createRoom(boardId); // story 5: it must exist before a socket opens
      const response = await upgrade(boardId, header);
      expect(response.status).toBe(101);
      response.webSocket?.close();
    }
  });

  it('TC-06 serves the built client for a board address', async () => {
    const boardId = newBoardId();
    const response = await get(`/b/${boardId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('id="root"');
  });

  it('TC-06 serves the built client for the root and for an unknown path', async () => {
    for (const path of ['/', '/index.html', '/some/where']) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('id="root"');
    }
  });
});

describe('TC-13, TC-17: capacity and separation', () => {
  it('TC-13 a 6th person is accepted and works like anyone else', async () => {
    const boardId = newBoardId();
    // One more than the design capacity: the design capacity is a target for
    // the design and the tests, never a limit anyone is turned away at.
    const crowd = MAX_CONCURRENT_EDITORS + 1;
    const names = Array.from({ length: crowd }, (_unused, index) => `Person ${index + 1}`);
    const clients = await connectClients(boardId, names);
    expect((await inspectRoom(boardId)).sockets).toBe(crowd);

    // and the extra person both sees the board and is seen by it
    const last = clients[clients.length - 1];
    const first = clients[0];
    const id = last.createNote();
    last.setText(id, 'typed by the 6th person');
    await first.waitForText(id, 'typed by the 6th person');
    for (const client of clients) expect(client.noteIds()).toEqual([id]);

    for (const client of clients) client.close();
  });

  it('TC-13 the socket route itself does not count people either', async () => {
    const boardId = newBoardId();
    await createRoom(boardId); // story 5: the board must exist to be joined
    for (let index = 0; index < MAX_CONCURRENT_EDITORS + 3; index++) {
      const response = await upgrade(boardId);
      expect(response.status).toBe(101);
    }
    expect((await inspectRoom(boardId)).sockets).toBe(MAX_CONCURRENT_EDITORS + 3);
  });

  it('TC-17 two boards are two objects and nothing crosses', async () => {
    const boardA = newBoardId();
    const boardB = newBoardId();
    const [onA] = await connectClients(boardA, ['Ada']);
    const [onB] = await connectClients(boardB, ['Bo']);

    const id = onA.createNote();
    onA.setText(id, 'only ever on a');
    await settle(onA);
    await settle(onB);

    // TC-17 must not happen: updates must not cross boards
    expect(onB.noteIds()).toEqual([]);
    // Nothing was relayed to the other board, not even an update echo: the
    // only frame Bo's socket carried was this board's own step one.
    expect(onB.updateFramesReceived).toBe(0);
    expect(onB.awarenessFramesReceived).toBe(0);
    expect((await inspectRoom(boardB)).notes).toBe(0);
    expect((await inspectRoom(boardA)).notes).toBe(1);

    const idA = env.BOARD_ROOM.idFromName(boardA).toString();
    const idB = env.BOARD_ROOM.idFromName(boardB).toString();
    expect(idA).not.toBe(idB);

    onA.close();
    onB.close();
  });

  it('TC-17 the id alone decides which object a connection lands in', async () => {
    const boardIds = [newBoardId(), newBoardId(), newBoardId(), newBoardId()];
    // Create the boards before spying on lookups, so `names` below holds only
    // the lookups the upgrades themselves make (story 5 needs a board to exist
    // first; that creation is not what this test is about).
    for (const boardId of boardIds) await createRoom(boardId);
    const { names, ids } = spyOnLookup();
    for (const boardId of boardIds) {
      const response = await upgrade(boardId);
      expect(response.status).toBe(101);
      response.webSocket?.close();
    }
    expect(names).toEqual(boardIds);
    expect(new Set(ids).size).toBe(4);
    // The same board again is the same object: that is how a reconnecting
    // person gets back the board they were on.
    const again = await upgrade(boardIds[0] as string);
    expect(again.status).toBe(101);
    again.webSocket?.close();
    expect(ids[4]).toBe(ids[0]);
  });
});

describe('the storage hooks are not a production route', () => {
  // The corruption and repair hooks live behind `TEST_HOOKS`, which the end-to-end
  // wrangler environment sets and the deployed config never does. These tests run
  // against `wrangler.jsonc` exactly as it ships, so `env.TEST_HOOKS` is absent
  // here — which is what production is. A hook request must never be answered by
  // the hook: it never returns the hook's JSON, and (decisively) it never looks a
  // board object up, so a deployed board can never be corrupted or repaired over
  // HTTP. Inert, the static-assets layer answers instead — the SPA for a GET, a
  // method-not-allowed for a POST — and neither is the hook.
  const hookPost = (path: string): Promise<Response> => get(path, { method: 'POST' });

  for (const action of ['corrupt-snapshot', 'repair'] as const) {
    it(`a ${action} request is never the hook, and never touches a board, without the flag`, async () => {
      const { names } = spyOnLookup();
      const boardId = newBoardId();
      const response = await hookPost(`/api/__test/boards/${boardId}/${action}`);
      // The hook answers with `{"ok":…}` JSON; an inert route never does.
      expect(response.headers.get('content-type') ?? '').not.toContain('application/json');
      expect(await response.text()).not.toContain('"ok"');
      // Decisively: a live hook would look this board up; inert, none was touched.
      expect(names).toEqual([]);
    });
  }
});
