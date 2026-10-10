import { describe, it, expect, afterEach } from 'vitest';
import { abortAllDurableObjects, reset } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { moveObject } from '../../src/shared/board-model';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import {
  addSticky,
  awarenessFrame,
  connectRoom,
  equalBytes,
  hasRoom,
  insertText,
  newBoardIdFor,
  newUnusedBoardId,
  openClient,
  ProtocolClient,
  queryAwarenessFrame,
  reconnect,
  settle,
  roomSnapshot,
} from './helpers/room';

/**
 * TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31 (anchor `sync.room`).
 *
 * Every test drives a real `BoardRoom` over real WebSockets with the real
 * y-websocket framing: nothing about merging, broadcasting, relaying or closing
 * is stubbed. Each test uses its own board, so no test can see another test's
 * participants or document.
 *
 * The dimension class of each run (D1 object type, D2 concurrent writers, D3
 * participants, D4 connection behaviour) is named in the test title.
 */

const OPEN: { close(): void }[] = [];

afterEach(async () => {
  for (const socket of OPEN.splice(0)) {
    try {
      socket.close();
    } catch {
      // Already gone.
    }
  }
  await abortAllDurableObjects();
  await reset();
});

const keep = <T extends { close(): void }>(socket: T): T => {
  OPEN.push(socket);
  return socket;
};

/** Join `board`'s room as a protocol-level client, registered for cleanup. */
const join = async (board: string): Promise<ProtocolClient> =>
  keep(await openClient(board));

const texts = (client: ProtocolClient): string[] => client.snapshot().map((note) => note.text);
const roomTexts = async (board: string): Promise<string[]> =>
  (await roomSnapshot(board)).map((note) => note.text);

/** Wait until every client has seen `count` more changes than it had. */
const everyoneSees = async (
  clients: readonly ProtocolClient[],
  before: readonly number[],
  count: number,
  timeoutMs = 5_000,
): Promise<void> => {
  for (const [index, client] of clients.entries()) {
    await client.waitForUpdates((before[index] ?? 0) + count, timeoutMs);
  }
};

const updateCounts = (clients: readonly ProtocolClient[]): number[] =>
  clients.map((client) => client.updateCount());

describe('one edit reaches the others (live.propagate)', () => {
  it('TC-07: B receives exactly one update from A, within the latency budget (D1 sticky/D2 1 writer/D3 2/D4 steady)', async () => {
    const board = newBoardIdFor('tc07');
    const a = await join(board);
    const b = await join(board);

    const before = updateCounts([a, b]);
    const started = Date.now();
    a.edit((doc) => {
      addSticky(doc, 100, 100, 'hello from A');
    });

    await b.waitForUpdates(before[1]! + 1);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

    // Nothing else arrived, so exactly one update message reached B.
    await settle(400);
    expect(b.updateCount()).toBe(before[1]! + 1);
    expect(texts(b)).toEqual(['hello from A']);
  });

  it('TC-08: the author receives no echo of its own change (D1 sticky/D2 1 writer/D3 2/D4 steady)', async () => {
    const board = newBoardIdFor('tc08');
    const a = await join(board);
    const b = await join(board);

    const before = updateCounts([a, b]);
    a.edit((doc) => {
      addSticky(doc, 0, 0, 'mine');
    });
    // Wait for the change to reach the other participant, so the room has had
    // every chance to echo it back to its author.
    await b.waitForUpdates(before[1]! + 1);
    await settle(400);
    expect(a.updateCount()).toBe(before[0]);

    expect(texts(a)).toEqual(['mine']);
    expect(texts(b)).toEqual(['mine']);
  });

  it('the room holds the board too, not only the sockets (D1 sticky/D2 1 writer/D3 1/D4 steady)', async () => {
    const board = newBoardIdFor('roomcopy');
    const a = await join(board);
    a.edit((doc) => {
      addSticky(doc, 10, 10, 'room copy');
    });
    expect(await roomTexts(board)).toEqual(['room copy']);
  });
});

describe('late joiners see the current board (live.join_state)', () => {
  it('TC-14: a change made by a client that has already left is visible to a new client (D1 sticky/D2 1 writer/D3 2/D4 steady)', async () => {
    const board = newBoardIdFor('tc14');
    const first = await join(board);
    first.edit((doc) => {
      addSticky(doc, 5, 5, 'from the first client');
    });
    first.close();
    await first.socket.closed();

    const later = await join(board);
    expect(texts(later)).toEqual(['from the first client']);
    expect(await roomTexts(board)).toEqual(['from the first client']);
  });

  it('a joiner carrying its own unsent edits merges them with the room (D1 sticky/D2 2 writers/D3 2/D4 reconnect)', async () => {
    const board = newBoardIdFor('joinmerge');
    const a = await join(board);
    a.edit((doc) => {
      addSticky(doc, 1, 1, 'a');
    });
    const beforeA = a.updateCount();

    // B creates a note while it is exchanging nothing with the room.
    const socket = keep(await connectRoom(board));
    const b = new ProtocolClient(socket);
    b.pause();
    addSticky(b.doc, 2, 2, 'b');
    b.resume();
    await b.handshake();

    await a.waitForUpdates(beforeA + 1);
    expect(texts(b).sort()).toEqual(['a', 'b']);
    expect(texts(a).sort()).toEqual(['a', 'b']);
    expect((await roomTexts(board)).sort()).toEqual(['a', 'b']);
  });
});

describe('concurrent edits (live.concurrent_text, live.converge)', () => {
  /** Put both clients in the same known state before they edit unseen by each other. */
  const sharedNote = async (
    board: string,
  ): Promise<{ a: ProtocolClient; b: ProtocolClient; id: string }> => {
    const a = await join(board);
    const b = await join(board);
    let id = '';
    a.edit((doc) => {
      id = addSticky(doc, 20, 20, 'base');
    });
    await b.waitForUpdates(1);
    expect(texts(b)).toEqual(['base']);
    return { a, b, id };
  };

  it('TC-09: notes created at the same time end up on both boards with the same ids (D1 sticky/D2 2 writers/D3 2/D4 steady)', async () => {
    const board = newBoardIdFor('tc09');
    const a = await join(board);
    const b = await join(board);
    const before = updateCounts([a, b]);

    let idA = '';
    let idB = '';
    a.edit((doc) => {
      idA = addSticky(doc, 0, 0, 'from A');
    });
    b.edit((doc) => {
      idB = addSticky(doc, 100, 0, 'from B');
    });

    await everyoneSees([a, b], before, 1);
    const expected = [idA, idB].sort();
    expect(a.snapshot().map((note) => note.id).sort()).toEqual(expected);
    expect(b.snapshot().map((note) => note.id).sort()).toEqual(expected);
    expect((await roomSnapshot(board)).map((note) => note.id).sort()).toEqual(expected);
  });

  it('TC-10: text typed in both editors at once keeps both texts, identically on both sides (D1 text/D2 2 writers/D3 2/D4 steady)', async () => {
    const board = newBoardIdFor('tc10');
    const { a, b, id } = await sharedNote(board);
    const before = updateCounts([a, b]);

    a.edit((doc) => {
      insertText(doc, id, 4, ', left');
    });
    b.edit((doc) => {
      insertText(doc, id, 4, ', right');
    });

    await everyoneSees([a, b], before, 1);

    const textA = texts(a)[0] ?? '';
    const textB = texts(b)[0] ?? '';
    expect(textA).toBe(textB); // converged: both boards hold the same text
    expect(textA).toContain('left');
    expect(textA).toContain('right');
    expect(textA.startsWith('base')).toBe(true);
    expect((await roomSnapshot(board))[0]?.text).toBe(textA);
  });

  it('TC-11: a note moved in both editors at once ends at one position on both sides (D1 sticky/D2 2 writers/D3 2/D4 steady)', async () => {
    const board = newBoardIdFor('tc11');
    const { a, b, id } = await sharedNote(board);
    const before = updateCounts([a, b]);

    a.edit((doc) => {
      moveObject(doc, id, 111, 222);
    });
    b.edit((doc) => {
      moveObject(doc, id, 333, 444);
    });

    await everyoneSees([a, b], before, 1);

    const positionOf = (client: ProtocolClient) => {
      const note = client.snapshot()[0];
      return note === undefined ? null : { x: note.x, y: note.y };
    };
    const fromA = positionOf(a);
    const fromB = positionOf(b);
    const room = (await roomSnapshot(board))[0];
    expect(fromA).not.toBeNull();
    expect(fromB).toEqual(fromA);
    expect({ x: room?.x, y: room?.y }).toEqual(fromA);
    // One move won outright; the two positions were never mixed together.
    expect(isOneOf(fromA!, [[111, 222], [333, 444]])).toBe(true);
  });

  it('TC-12: MAX_CONCURRENT_EDITORS participants all see each other within the budget (D1 sticky/D2 5 writers/D3 5/D4 steady)', async () => {
    const board = newBoardIdFor('tc12');
    const clients: ProtocolClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      clients.push(await join(board));
    }
    expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS);

    const before = updateCounts(clients);
    const started = Date.now();
    clients.forEach((client, index) => {
      client.edit((doc) => {
        addSticky(doc, index * 10, 0, `editor ${index}`);
      });
    });

    // Each participant must receive a change from every other participant.
    await everyoneSees(clients, before, MAX_CONCURRENT_EDITORS - 1, 10_000);
    expect(Date.now() - started).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

    const expected = clients.map((_, index) => `editor ${index}`);
    for (const client of clients) {
      expect(texts(client).sort()).toEqual(expected);
    }
    expect((await roomTexts(board)).sort()).toEqual(expected);
  });
});

describe('bad traffic (live.invalid_update, awareness relay)', () => {
  it('TC-15: an invalid update closes only that socket and leaves the room document unchanged (D1 sticky/D2 1 writer/D3 3/D4 malformed)', async () => {
    const board = newBoardIdFor('tc15');
    const a = await join(board);
    const b = await join(board);
    a.edit((doc) => {
      addSticky(doc, 1, 1, 'kept');
    });
    await b.waitForUpdates(1);
    expect(await roomTexts(board)).toEqual(['kept']);

    // A third participant sends bytes that are not an update this document can
    // accept.
    const offender = await join(board);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, new Uint8Array([0xff, 0xfe, 0xfd]));
    offender.socket.send(encoding.toUint8Array(encoder));

    expect((await offender.socket.closed()).code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await roomTexts(board)).toEqual(['kept']);
    expect(texts(b)).toEqual(['kept']);

    // Everyone else keeps working.
    const beforeA = a.updateCount();
    b.edit((doc) => {
      addSticky(doc, 2, 2, 'after');
    });
    await a.waitForUpdates(beforeA + 1);
    expect((await roomTexts(board)).sort()).toEqual(['after', 'kept']);
  });

  it('TC-16: awareness bytes are relayed to every socket, the sender included (D1 sticky/D2 1 writer/D3 2/D4 steady)', async () => {
    const board = newBoardIdFor('tc16');
    const a = await join(board);
    const b = await join(board);
    const markerA = a.socket.frameCount();
    const markerB = b.socket.frameCount();

    const frame = awarenessFrame(a.doc, a.awareness);
    a.socket.send(frame);

    await a.socket.waitForFrames(markerA + 1);
    await b.socket.waitForFrames(markerB + 1);

    const echoed = a.socket.frames.slice(markerA);
    const relayed = b.socket.frames.slice(markerB);
    expect(echoed.some((candidate) => equalBytes(candidate, frame))).toBe(true);
    expect(relayed.some((candidate) => equalBytes(candidate, frame))).toBe(true);
    // Awareness never changes the document.
    expect(texts(a)).toEqual([]);
    expect(a.updateCount()).toBe(0);
  });

  it('an awareness query is answered with nothing and leaves the room working (D1 sticky/D2 1 writer/D3 1/D4 steady)', async () => {
    const board = newBoardIdFor('awarequery');
    const a = await join(board);
    const marker = a.socket.frameCount();

    a.socket.send(queryAwarenessFrame());
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    await settle(300);
    expect(a.socket.frameCount()).toBe(marker);

    a.edit((doc) => {
      addSticky(doc, 3, 3, 'query ok');
    });
    expect(await roomTexts(board)).toEqual(['query ok']);
  });

  it('TC-31: a socket that dies mid-broadcast does not break delivery for the others (D1 sticky/D2 1 writer/D3 3/D4 reconnect)', async () => {
    const board = newBoardIdFor('tc31');
    const a = await join(board);
    const b = await join(board);
    const c = await join(board);
    const beforeC = c.updateCount();

    // B disappears, and in the same tick A edits.
    b.socket.close(1001, 'going away');
    a.edit((doc) => {
      addSticky(doc, 7, 7, 'after a drop');
    });

    await c.waitForUpdates(beforeC + 1);
    expect(texts(c)).toEqual(['after a drop']);
    expect(await roomTexts(board)).toEqual(['after a drop']);

    // The room is still healthy for the survivors.
    const beforeA = a.updateCount();
    c.edit((doc) => {
      addSticky(doc, 8, 8, 'second');
    });
    await a.waitForUpdates(beforeA + 1);
    expect((await roomTexts(board)).sort()).toEqual(['after a drop', 'second']);
    expect(texts(a).sort()).toEqual(['after a drop', 'second']);
  });
});

describe('room restart (live.catch_up, sequence "room restart")', () => {
  it('TC-18: after the object is aborted, the first reconnection repopulates the room (D1 sticky/D2 2 writers/D3 2/D4 reconnect)', async () => {
    const board = newBoardIdFor('tc18');
    const a = await join(board);
    a.edit((doc) => {
      addSticky(doc, 12, 34, 'survives the restart');
    });

    // Abrupt loss of the object: its in-memory board is gone, its sockets die.
    await abortAllDurableObjects();

    // The client reconnects, exactly as the browser provider's automatic retry
    // does, carrying the board it already had.
    const reconnected = keep(await reconnect(a, board));
    expect(texts(reconnected)).toEqual(['survives the restart']);
    expect(await roomTexts(board)).toEqual(['survives the restart']);

    // A newcomer sees the same board.
    const newcomer = await join(board);
    expect(texts(newcomer)).toEqual(['survives the restart']);

    // And the board keeps working afterwards.
    const id = reconnected.snapshot()[0]?.id ?? '';
    const beforeNewcomer = newcomer.updateCount();
    reconnected.edit((doc) => {
      insertText(doc, id, 0, 'edited ');
    });
    await newcomer.waitForUpdates(beforeNewcomer + 1);
    expect(texts(newcomer)).toEqual(['edited survives the restart']);
    expect(texts(reconnected)).toEqual(['edited survives the restart']);
  });

  it('an empty board costs no room until someone connects (D1 sticky/D2 1 writer/D3 1/D4 steady)', async () => {
    const board = newBoardIdFor('emptyroom');
    expect(await hasRoom(board)).toBe(false);
    const a = await join(board);
    expect(await hasRoom(board)).toBe(true);
    expect(texts(a)).toEqual([]);
    // A board nobody has opened still has no room, even while another one does.
    expect(await hasRoom(newUnusedBoardId())).toBe(false);
  });
});

/** Is `position` exactly one of the candidate positions? */
function isOneOf(
  position: { x: number; y: number },
  candidates: readonly (readonly number[])[],
): boolean {
  return candidates.some(([x, y]) => position.x === x && position.y === y);
}
