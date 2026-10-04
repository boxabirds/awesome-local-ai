/**
 * BoardRoom relay behaviour (task 6): TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31.
 *
 * Everything here runs in workerd against the real Durable Object, with clients
 * that speak the real y-websocket framing (see `ws-client.ts`).
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS } from '../../src/shared/protocol';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  boardState,
  converge,
  corruptUpdateFrame,
  connectAll,
  freshBoardId,
  RoomClient,
} from './ws-client';
import { applyRandomOps, RANDOM_OPS_SEED, seededRandom } from './random-ops';

describe('a write reaches everybody else (TC-07)', () => {
  it('relays a created note and sends the sender no echo', async () => {
    const [a, b] = await connectAll(freshBoardId(), 2);

    const updatesBefore = b.syncFramesWithRank(2).length;
    createSticky(a.doc, { x: 120, y: 80 });
    await b.seesNoteCount(1);

    expect(boardState(b)).toBe(boardState(a));
    // Exactly one relayed update message, not a re-sync and not a duplicate.
    expect(b.syncFramesWithRank(2).length - updatesBefore).toBe(1);

    a.destroy();
    b.destroy();
  });
});

describe('every kind of edit propagates (TC-08)', () => {
  async function twoEditors(): Promise<[RoomClient, RoomClient, string]> {
    const [a, b] = await connectAll(freshBoardId(), 2);
    const id = createSticky(a.doc, { x: 10, y: 20 });
    await b.seesNoteCount(1);
    return [a, b, id];
  }

  it('moves a note', async () => {
    const [a, b, id] = await twoEditors();
    const echoed = a.syncFramesWithRank(2).length;
    moveObject(a.doc, id, 340, 210);
    await b.waitFor(() => (b.notes.find((n) => n.id === id)?.x ?? NaN) === 340, 'the move');
    expect(boardState(b)).toBe(boardState(a));
    expect(a.syncFramesWithRank(2).length).toBe(echoed);
    a.destroy();
    b.destroy();
  });

  it('recolours a note', async () => {
    const [a, b, id] = await twoEditors();
    const echoed = a.syncFramesWithRank(2).length;
    const color: StickyColor = 'blue';
    setStickyColor(a.doc, id, color);
    await b.waitFor(() => (b.notes.find((n) => n.id === id)?.color ?? '') === color, 'the colour');
    expect(boardState(b)).toBe(boardState(a));
    expect(a.syncFramesWithRank(2).length).toBe(echoed);
    a.destroy();
    b.destroy();
  });

  it('inserts text', async () => {
    const [a, b, id] = await twoEditors();
    const echoed = a.syncFramesWithRank(2).length;
    getStickyText(a.doc, id)?.insert(0, 'write it down');
    await b.waitFor(() => b.notes.find((n) => n.id === id)?.text === 'write it down', 'the text');
    expect(boardState(b)).toBe(boardState(a));
    expect(a.syncFramesWithRank(2).length).toBe(echoed);
    a.destroy();
    b.destroy();
  });

  it('deletes a note', async () => {
    const [a, b, id] = await twoEditors();
    const echoed = a.syncFramesWithRank(2).length;
    expect(deleteObject(a.doc, id)).toBe(true);
    await b.seesNoteCount(0);
    expect(b.notes.find((n) => n.id === id)).toBeUndefined();
    expect(boardState(b)).toBe(boardState(a));
    expect(a.syncFramesWithRank(2).length).toBe(echoed);
    a.destroy();
    b.destroy();
  });
});

describe('concurrent edits converge (TC-09, TC-10, TC-11)', () => {
  /**
   * Two editors on the same note, changed in one synchronous block: the room
   * cannot relay anything in between, so both writes are genuinely concurrent.
   */
  async function concurrentPair(): Promise<[RoomClient, RoomClient, string]> {
    const [a, b] = await connectAll(freshBoardId(), 2);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)?.insert(0, 'green');
    await b.waitFor(() => b.notes.find((n) => n.id === id)?.text === 'green', 'the seed text');
    return [a, b, id];
  }

  it('merges concurrent text inserts into one string (TC-09)', async () => {
    const [a, b, id] = await concurrentPair();
    const textA = getStickyText(a.doc, id)!;
    const textB = getStickyText(b.doc, id)!;
    textA.insert(0, 'red ');
    textB.insert(textB.length, ' blue');

    await converge([a, b]);
    expect(a.notes.find((n) => n.id === id)?.text).toBe('red green blue');
    expect(b.notes.find((n) => n.id === id)?.text).toBe('red green blue');
    a.destroy();
    b.destroy();
  });

  it('picks one winner for a concurrent move and agrees on it (TC-10)', async () => {
    const [a, b, id] = await concurrentPair();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    await converge([a, b]);
    const xA = a.notes.find((n) => n.id === id)?.x;
    const xB = b.notes.find((n) => n.id === id)?.x;
    expect(xA).toBe(xB);
    expect([100, 300]).toContain(xA);
    a.destroy();
    b.destroy();
  });

  it('keeps a deleted note deleted when somebody types in it (TC-11)', async () => {
    const [a, b, id] = await concurrentPair();
    getStickyText(b.doc, id)?.insert(0, 'typed into a doomed note');
    deleteObject(a.doc, id);

    await converge([a, b]);
    expect(a.notes).toHaveLength(0);
    expect(b.notes).toHaveLength(0);

    // The text is not hiding anywhere: a newcomer sees an empty board, and the
    // deleted note is not resurrected by further edits.
    const c = await RoomClient.connect(a.boardId);
    expect(c.notes).toHaveLength(0);
    createSticky(b.doc, { x: 5, y: 5 });
    await converge([a, b, c]);
    expect(c.notes).toHaveLength(1);
    expect(c.notes[0]?.id).not.toBe(id);
    a.destroy();
    b.destroy();
    c.destroy();
  });
});

describe('a full room of editors (TC-12)', () => {
  it('converges after every client performs 200 seeded random ops', async () => {
    const boardId = freshBoardId();
    const clients = await connectAll(boardId, MAX_CONCURRENT_EDITORS);
    const random = seededRandom(RANDOM_OPS_SEED);
    console.log(`TC-12: seed ${RANDOM_OPS_SEED}, ${MAX_CONCURRENT_EDITORS} editors x 200 ops`);

    const expected = new Set<string>();
    for (const [index, client] of clients.entries()) {
      const result = applyRandomOps(client.doc, 200, random, index * 10_000);
      for (const id of result.live) expected.add(id);
    }

    await converge(clients, 30000);
    const ids = new Set(clients[0].notes.map((n) => n.id));
    expect(ids.size).toBe(clients[0].notes.length);
    for (const id of expected) expect(ids.has(id), `missing ${id}`).toBe(true);
    expect(clients[0].notes).toHaveLength(expected.size);

    // One newcomer sees exactly the same board.
    const late = await RoomClient.connect(boardId);
    await late.waitFor(() => boardState(late) === boardState(clients[0]), 'late joiner to catch up', 30000);
    expect(late.notes).toHaveLength(expected.size);

    for (const client of clients) client.destroy();
    late.destroy();
  }, 60000);
});

describe('a late joiner gets the whole board (TC-14)', () => {
  it('syncs the existing 20 notes on connect', async () => {
    const boardId = freshBoardId();
    const [a, b] = await connectAll(boardId, 2);
    for (let i = 0; i < 20; i++) {
      createSticky(i % 2 === 0 ? a.doc : b.doc, { x: i * 30, y: i * 12 });
    }
    await converge([a, b]);
    expect(a.notes).toHaveLength(20);

    const c = await RoomClient.connect(boardId);
    expect(c.notes).toHaveLength(20);
    expect(boardState(c)).toBe(boardState(a));

    a.destroy();
    b.destroy();
    c.destroy();
  });
});

describe('malformed traffic closes one socket only (TC-15)', () => {
  /** One bad frame per run; each is rejected before it can carry an operation. */
  function badFrames(): { name: string; frame: Uint8Array | string }[] {
    const whole = corruptUpdateFrame(Y.encodeStateAsUpdate(docWithNote()));
    return [
      { name: 'a text frame', frame: 'hello, I am not binary' },
      { name: 'truncated bytes', frame: whole.slice(0, whole.byteLength - 3) },
      { name: 'an unknown message type', frame: new Uint8Array([42, 1, 2, 3]) },
      { name: 'an invalid yjs update', frame: corruptUpdateFrame(new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7])) },
    ];
  }

  function docWithNote(): Y.Doc {
    const doc = new Y.Doc();
    createSticky(doc, { x: 1, y: 1 });
    return doc;
  }

  for (const bad of badFrames()) {
    it(`closes the sender for ${bad.name}`, async () => {
      const boardId = freshBoardId();
      const [a, bystander] = await connectAll(boardId, 2);
      // One note exists before the rude behaviour.
      createSticky(bystander.doc, { x: 7, y: 7 });
      await a.seesNoteCount(1);

      if (typeof bad.frame === 'string') a.sendText(bad.frame);
      else a.sendBytes(bad.frame);

      const closed = await a.waitForClose();
      expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

      // The other editor is untouched and the room still relays for everybody.
      expect(bystander.closeCode).toBeNull();
      createSticky(bystander.doc, { x: 9, y: 9 });
      const late = await RoomClient.connect(boardId);
      await late.seesNoteCount(2);
      expect(boardState(late)).toBe(boardState(bystander));

      bystander.destroy();
      late.destroy();
    });
  }
});

describe('awareness relay (TC-16)', () => {
  it('hands every socket the same bytes, sender included', async () => {
    const [a, b] = await connectAll(freshBoardId(), 2);

    // Whatever A puts on the wire now must come back to sender and peer alike.
    a.awareness.setLocalStateField('cursor', { x: 3, y: 4 });
    const cursorFrame = a.sent[a.sent.length - 1]!;
    a.awareness.setLocalStateField('selection', 'note-1');
    const selectionFrame = a.sent[a.sent.length - 1]!;
    expect(cursorFrame[0]).toBe(MESSAGE_AWARENESS);

    await a.waitFor(
      () => a.receivedExactly(selectionFrame) && b.receivedExactly(selectionFrame),
      'the awareness update to reach both editors',
    );

    for (const frame of [cursorFrame, selectionFrame]) {
      expect(a.receivedExactly(frame), 'sender keeps a copy').toBe(true);
      expect(b.receivedExactly(frame), 'the peer gets it verbatim').toBe(true);
    }
    expect(b.awarenessFrames().length).toBeGreaterThan(0);

    a.destroy();
    b.destroy();
  });
});

describe('room restart (TC-18)', () => {
  it('is repopulated by the first client that reconnects', async () => {
    const oldRoom = freshBoardId();
    const [a, b] = await connectAll(oldRoom, 2);
    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i, y: i });
    await converge([a, b]);
    // What the two browsers keep locally while they are open.
    const savedA = Y.encodeStateAsUpdate(a.doc);
    const savedB = Y.encodeStateAsUpdate(b.doc);

    // All sockets go down together; the room instance loses its memory.
    a.destroy();
    b.destroy();

    // A new object id means a brand-new instance with an empty document.
    const freshRoom = freshBoardId();
    const aAgain = await RoomClient.connect(freshRoom, { seed: savedA });
    const observer = await RoomClient.connect(freshRoom);
    await observer.seesNoteCount(3);
    expect(boardState(observer)).toBe(boardState(aAgain));

    // The second editor comes back and catches up with what the room rebuilt.
    const bAgain = await RoomClient.connect(freshRoom, { seed: savedB });
    await converge([aAgain, bAgain, observer]);
    expect(bAgain.notes).toHaveLength(3);

    aAgain.destroy();
    bAgain.destroy();
    observer.destroy();
  });
});

describe('a dead socket is dropped (TC-31)', () => {
  it('does not stop the room from relaying to everybody else', async () => {
    const boardId = freshBoardId();
    const [a, b] = await connectAll(boardId, 2);

    // B goes away abruptly; before the room notices, A writes.
    b.ws?.close();
    createSticky(a.doc, { x: 66, y: 66 });

    const c = await RoomClient.connect(boardId);
    await c.seesNoteCount(1);
    expect(boardState(c)).toBe(boardState(a));

    // And the room keeps working for a while after that.
    createSticky(a.doc, { x: 67, y: 67 });
    await c.seesNoteCount(2);

    a.destroy();
    c.destroy();
  });
});

