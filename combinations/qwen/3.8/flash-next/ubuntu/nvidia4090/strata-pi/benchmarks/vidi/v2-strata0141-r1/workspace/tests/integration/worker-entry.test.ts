import { describe, it, expect, afterEach } from 'vitest';
import { SELF, reset, runInDurableObject } from 'cloudflare:test';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { ROOM_ROUTE_PREFIX } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import {
  addSticky,
  bindings,
  connectRoom,
  hasRoom,
  newBoardIdFor,
  roomCount,
  openClient,
} from './helpers/room';

/**
 * TC-04, TC-05, TC-06, TC-13, TC-17 (anchor `sync.worker_entry`).
 *
 * The Worker is reached through `SELF`, a service binding to the real `fetch`
 * handler described in `wrangler.jsonc`, so routing, the board-id validity
 * check, the assets fallback and the Durable Object hand-off are all the real
 * thing.
 *
 * Dimension classes: D1 = text insert, D2 = 1 writer, D3 = 1 participant,
 * D4 = steady connection (except TC-17, which is malformed traffic).
 */

const SELF_ORIGIN = 'http://board.test';
const OPEN_SOCKETS: { close(): void }[] = [];

afterEach(async () => {
  for (const socket of OPEN_SOCKETS.splice(0)) {
    socket.close();
  }
  // Let any room handler finish first: `reset()` deletes every board object, and
  // workerd complains when one is deleted while it is still inside a handler.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await reset();
});

const track = <T extends { close(): void }>(socket: T): T => {
  OPEN_SOCKETS.push(socket);
  return socket;
};

const roomState = async (boardId: string) => {
  const ns = bindings().BOARD_ROOM;
  const stub = ns.get(ns.idFromName(boardId));
  return runInDurableObject(stub, (instance) => instance.inspectDoc());
};

/**
 * Wait until the room has stored at least `rows` updates for `boardId`.
 *
 * A frame a client sends is not yet a frame the room has processed, and from
 * story 4 on a processed frame is a stored frame, so the stored row count is the
 * honest way to know the room has had the change.
 */
const waitForStoredRows = async (boardId: string, rows: number, timeoutMs = 5_000): Promise<void> => {
  const ns = bindings().BOARD_ROOM;
  const stub = ns.get(ns.idFromName(boardId));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const stats = await runInDurableObject(stub, (instance) => instance.testStats());
    if (stats.updateRows >= rows) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${rows} stored row(s); got ${stats.updateRows}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe('room routing', () => {
  it('TC-04: rejects invalid board ids with 400 and no Durable Object call', async () => {
    const roomsBefore = await roomCount();
    const invalid = [
      'not-valid', // too short
      'x'.repeat(23), // too long
      '', // no id at all
      '++++++++++++++++++++++', // base64, but not base64url
      'a'.repeat(21), // one character short (boundary)
      '..%2F..%2Fetc', // encoded path traversal
    ];
    for (const id of invalid) {
      expect(isValidBoardId(id)).toBe(false);
      const response = await SELF.fetch(`${SELF_ORIGIN}${ROOM_ROUTE_PREFIX}${id}`, {
        headers: { upgrade: 'websocket' },
      });
      expect(response.status).toBe(400);
    }
    // Rejecting a bad address never visits a room.
    expect(await roomCount()).toBe(roomsBefore);
  });

  it('TC-04: path traversal never reaches a room', async () => {
    const roomsBefore = await roomCount();
    // `new URL()` resolves `..` before routing, so the request leaves the room
    // route entirely: the client build answers, and no object is created.
    for (const path of ['/api/rooms/../etc', '/api/rooms/../../etc/passwd']) {
      const response = await SELF.fetch(`${SELF_ORIGIN}${path}`, {
        headers: { upgrade: 'websocket' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    }
    expect(await roomCount()).toBe(roomsBefore);
  });

  it('TC-05: /api/rooms/<valid> without an Upgrade header is refused with 426', async () => {
    const board = newBoardIdFor('tc05');
    const response = await SELF.fetch(`${SELF_ORIGIN}${ROOM_ROUTE_PREFIX}${board}`);
    expect(response.status).toBe(426);
    // Refusing the request is not a room visit: no object is created for it.
    expect(await hasRoom(board)).toBe(false);
  });

  it('TC-05: a valid board address serves the client and never touches the room', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`${SELF_ORIGIN}/b/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root"');
    expect(await hasRoom(id)).toBe(false);
  });

  it('TC-06: other paths are answered by the client build, not by a new route', async () => {
    const roomsBefore = await roomCount();
    for (const path of ['/', '/api/boards', '/api/sync', '/notes/1']) {
      const response = await SELF.fetch(`${SELF_ORIGIN}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    }
    expect(await roomCount()).toBe(roomsBefore);
  });

  it('TC-13: a valid board address upgrades to a WebSocket', async () => {
    const board = newBoardIdFor('tc13');
    const roomsBefore = await roomCount();
    const response = await SELF.fetch(`${SELF_ORIGIN}${ROOM_ROUTE_PREFIX}${board}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-version': '13' },
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (socket == null) {
      throw new Error('expected a WebSocket on the 101 response');
    }
    socket.accept();
    socket.close();
    expect(await hasRoom(board)).toBe(true);
    expect(await roomCount()).toBe(roomsBefore + 1);
  });

  it('TC-17: malformed frames close only that socket, with code 1003', async () => {
    const board = newBoardIdFor('tc17');
    const offender = track(await connectRoom(board));
    const witness = track(await openClient(board));

    offender.send(new Uint8Array([9, 1, 2, 3])); // unknown message type
    const close = await offender.closed();
    expect(close.code).toBe(CLOSE_UNSUPPORTED_DATA);

    // The room is intact: the other participant still edits normally, and the
    // edit is stored like any other.
    witness.edit((doc) => {
      addSticky(doc, 40, 40, 'still here');
    });
    await waitForStoredRows(board, 1);
    const notes = await roomState(board);
    expect(notes.map((note) => note.text)).toContain('still here');
  });
});
