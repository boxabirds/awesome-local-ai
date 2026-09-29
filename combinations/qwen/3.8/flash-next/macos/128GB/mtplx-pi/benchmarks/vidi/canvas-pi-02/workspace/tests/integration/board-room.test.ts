/**
 * Integration tests for the board room (design task 6: TC-07 to TC-12,
 * TC-14 to TC-16, TC-18, TC-31).
 *
 * A real `BoardRoom` object, real WebSockets and real Yjs: the clients in
 * `helpers/ws-client` speak the same framing the browser provider uses, so a
 * relay that is wrong in any way shows up as a wrong board here.
 *
 * @see spec/stories/03-live-collaboration/design.md
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { env } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { MESSAGE_AWARENESS } from '../../src/shared/protocol';
import { describeOperations, runRandomOperations } from '../fixtures/random-ops';
import {
  TestPeer,
  boardOf,
  boardsAgree,
  roomBoard,
  roomSocketCount,
  settle,
  waitFor,
} from './helpers/ws-client';

/**
 * Two editors on one fresh board, past their initial exchange.
 *
 * The board comes back with them: tests that talk to the room directly
 * (`roomBoard`, `roomSocketCount`, a third peer) must use this id, or they
 * would be looking at a different board than the two peers are on.
 */
async function pair(name = 'pair'): Promise<[string, TestPeer, TestPeer]> {
  const board = newBoardId();
  const a = await TestPeer.connect(board, { name: `${name}-A` });
  const b = await TestPeer.connect(board, { name: `${name}-B` });
  await settle([a, b]);
  return [board, a, b];
}

/** A note on `peer`'s board, centred on a point that is never a coincidence. */
function makeNote(peer: TestPeer, x = 40, y = 60): string {
  const id = createSticky(peer.doc, { x, y });
  expect(id).not.toBe('');
  return id;
}

/**
 * Whether the room stopped holding any socket for `board`.
 *
 * The client side of a test socket never sees its own `close` event when it
 * hangs up (both halves of a `WebSocketPair` are server-role), so the outage
 * in the restart test is measured where it is observable: in the room.
 */
async function socketsGone(board: string, attempts = 100): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await roomSocketCount(board)) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

/** A second `Y.Doc` holding exactly what `doc` holds. */
function replicate(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

describe('a change reaches the other editors (TC-07, TC-08)', () => {
  it('carries a created note to the other editor as exactly one update', async () => {
    const [, a, b] = await pair('create');

    makeNote(a);
    await waitFor(() => snapshot(b.doc).length === 1, 'B to receive the note');
    await settle([a, b]);

    expect(b.updateCount(), 'one update frame, not a re-sync').toBe(1);
    expect(JSON.stringify(snapshot(b.doc))).toBe(JSON.stringify(snapshot(a.doc)));
  });

  // One test per operation kind, each with the same two assertions: the other
  // board ends up identical, and the author is not echoed its own change.
  const kinds: Array<[string, (peer: TestPeer, id: string) => void]> = [
    ['a move', (peer, id) => void moveObject(peer.doc, id, 320, -140)],
    ['a recolour', (peer, id) => void setStickyColor(peer.doc, id, 'violet')],
    [
      'a text insert',
      (peer, id) => {
        const text = getStickyText(peer.doc, id);
        expect(text).toBeDefined();
        peer.doc.transact(() => text?.insert(0, 'rename the tab'), LOCAL_ORIGIN);
      },
    ],
    ['a delete', (peer, id) => void deleteObject(peer.doc, id)],
  ];

  for (const [label, mutate] of kinds) {
    it(`carries ${label} and does not echo it to its author`, async () => {
      const [, a, b] = await pair('kind');
      const id = makeNote(a);
      await settle([a, b]);

      const authorFrames = a.frames.length;
      const otherFrames = b.frames.length;
      mutate(a, id);
      await waitFor(
        () => JSON.stringify(snapshot(b.doc)) === JSON.stringify(snapshot(a.doc)),
        `B to match A after ${label}`,
      );
      await settle([a, b]);

      expect(b.frames.length, 'the other editor received the change').toBeGreaterThan(
        otherFrames,
      );
      expect(a.frames.length, 'no echo to the author').toBe(authorFrames);
    });
  }
});

describe('concurrent edits keep everything (TC-09, TC-10, TC-11)', () => {
  it('keeps both halves of a note typed into from two places at once', async () => {
    const [, a, b] = await pair('text');
    const id = makeNote(a);
    a.doc.transact(() => getStickyText(a.doc, id)?.insert(0, 'green'), LOCAL_ORIGIN);
    await waitFor(() => snapshot(b.doc).length === 1, 'B to hold the seeded note');
    await settle([a, b]);
    expect(getStickyText(b.doc, id)?.toString()).toBe('green');

    // Neither side has seen the other yet: both writes are made in the same
    // tick, which is the only way to be sure they are really concurrent.
    a.doc.transact(() => getStickyText(a.doc, id)?.insert(0, 'red '), LOCAL_ORIGIN);
    b.doc.transact(() => getStickyText(b.doc, id)?.insert(5, ' blue'), LOCAL_ORIGIN);

    await waitFor(
      () => boardsAgree([a, b]) && (getStickyText(a.doc, id)?.toString().length ?? 0) === 14,
      'both boards to read "red green blue"',
    );
    expect(getStickyText(a.doc, id)?.toString()).toBe('red green blue');
    expect(getStickyText(b.doc, id)?.toString()).toBe('red green blue');
  });

  it('settles two writes to one position on the same value', async () => {
    const [, a, b] = await pair('position');
    const id = makeNote(a);
    await settle([a, b]);

    moveObject(a.doc, id, 100, 60);
    moveObject(b.doc, id, 300, 60);

    await waitFor(() => boardsAgree([a, b]), 'both boards to agree on x');
    const xOf = (peer: TestPeer): number => Number(
      (peer.doc.getMap<Y.Map<unknown>>('objects').get(id) as Y.Map<unknown>).get('x'),
    );
    expect(xOf(b)).toBe(xOf(a));
    expect([100, 300]).toContain(xOf(a));
  });

  it('lets a delete win over a edit made at the same moment', async () => {
    const [, a, b] = await pair('delete');
    const id = makeNote(a);
    await settle([a, b]);

    deleteObject(a.doc, id);
    b.doc.transact(() => getStickyText(b.doc, id)?.insert(0, 'late words'), LOCAL_ORIGIN);

    await waitFor(() => boardsAgree([a, b]), 'both boards to drop the note');
    for (const peer of [a, b]) {
      const board = JSON.stringify(snapshot(peer.doc));
      expect(board, `${peer.name} lost the note`).not.toContain(id);
      // The text written into a deleted note has nowhere to live.
      expect(board).not.toContain('late words');
      expect(peer.closed, `${peer.name} stayed connected`).toBe(false);
    }
  });
});

describe('a full board of editors converges (TC-12, TC-13 capacity is in worker.test.ts)', () => {
  it('brings five editors running 200 operations each to one board', async () => {
    const board = newBoardId();
    const peers: TestPeer[] = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
      peers.push(await TestPeer.connect(board, { name: `editor-${index}` }));
    }
    await settle(peers);

    // Seeded, so a failure can be replayed: the seeds are printed below.
    const seeds = peers.map((_, index) => 20260925 + index * 977);
    const runs = peers.map((peer, index) =>
      runRandomOperations(peer.doc, { seed: seeds[index]!, count: 200 }),
    );
    console.log(
      `TC-12 seeds: ${seeds.join(', ')}; ${runs.map((run) => describeOperations(run)).join(' | ')}`,
    );

    await waitFor(() => boardsAgree(peers), 'all five boards to converge');
    await settle(peers);
    expect(peers.map((peer) => peer.closed)).toEqual(peers.map(() => false));

    const reference = JSON.stringify(snapshot(peers[0]!.doc));
    for (const peer of peers) {
      expect(JSON.stringify(snapshot(peer.doc)), peer.name).toBe(reference);
    }
    // The room's own copy agrees too, which is what a late joiner would get.
    expect(await roomBoard(board), 'the room holds the same board').toBe(reference);
  });
});

describe('a late joiner catches up (TC-14)', () => {
  it('brings twenty notes to a client that connects afterwards', async () => {
    const board = newBoardId();
    const a = await TestPeer.connect(board, { name: 'A' });
    const b = await TestPeer.connect(board, { name: 'B' });
    await settle([a, b]);

    for (let index = 0; index < 20; index += 1) {
      createSticky(index % 2 === 0 ? a.doc : b.doc, { x: index * 30, y: index * -20 });
    }
    await waitFor(() => snapshot(a.doc).length === 20, 'both to hold 20 notes');
    await settle([a, b]);

    const late = await TestPeer.connect(board, { name: 'C' });
    await settle([a, b, late]);
    await waitFor(() => boardsAgree([a, b, late]), 'the late joiner to catch up');

    expect(snapshot(late.doc)).toHaveLength(20);
    expect(JSON.stringify(snapshot(late.doc))).toBe(JSON.stringify(snapshot(a.doc)));
  });
});

describe('bad traffic costs one connection (TC-15)', () => {
  // Built with the same encoders the room uses, so each payload fails on its
  // meaning and not on a sloppy test fixture.
  const badFrames: Array<[string, () => Uint8Array | string]> = [
    ['a text frame', () => 'please sync my board'],
    ['truncated bytes', () => new Uint8Array([0, 2, 5, 1, 2])],
    ['an unknown message type', () => new Uint8Array([9, 0, 0])],
    [
      'an invalid Yjs update',
      () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        encoding.writeVarUint8Array(encoder, new Uint8Array([2, 1, 2, 3, 4, 5]));
        return encoding.toUint8Array(encoder);
      },
    ],
  ];

  for (const [label, build] of badFrames) {
    it(`closes the author for ${label}, and leaves the board alone`, async () => {
      const [board, a, b] = await pair('bad');
      const before = await roomBoard(board);

      const payload = build();
      if (typeof payload === 'string') a.sendText(payload);
      else a.send(payload);

      await waitFor(() => a.closed, `A to be closed for ${label}`);
      expect(a.closeCode).toBe(1003);

      // The other editor is untouched, and the board did not change.
      expect(b.closed, 'B is still connected').toBe(false);
      expect(b.socket.readyState).toBe(WebSocket.OPEN);
      expect(await roomBoard(board), 'the room kept the document it had').toBe(before);

      // ...and the board still works: a newcomer's note reaches B.
      const late = await TestPeer.connect(board, { name: 'late' });
      await settle([b, late]);
      makeNote(late, 500, 500);
      await waitFor(() => snapshot(b.doc).length === 1, 'B to receive a later note');
      expect(await roomSocketCount(board), 'the closed socket was dropped').toBe(2);
    });
  }
});

describe('presence traffic is relayed as it arrived (TC-16)', () => {
  it('gives both editors the same awareness bytes', async () => {
    const [, a, b] = await pair('awareness');
    // One awareness update, framed the way the provider frames one:
    // `[1][length][bytes]`. The room relays that frame unchanged.
    const frame = new Uint8Array([1, 7, 0, 1, 7, 3, 64, 1, 2]);
    const framesBefore = b.frames.length;

    a.send(frame);
    await waitFor(() => b.frames.length > framesBefore, 'B to receive the awareness frame');
    await settle([a, b]);

    const saw = (peer: TestPeer): boolean =>
      peer.frames.some(
        (record) =>
          record.kind === 'awareness' &&
          record.bytes.byteLength === frame.byteLength &&
          Uint8Array.from(record.bytes).every((byte, index) => byte === frame[index]),
      );
    expect(saw(b), 'B to be given the presence frame').toBe(true);
    // The sender keeps its own presence traffic: that is what stops y-websocket
    // deciding an idle connection is dead.
    expect(saw(a), 'A to be given its own presence frame back').toBe(true);
  });
});

describe('a room that was rebuilt is filled again (TC-18)', () => {
  it('lets the first editor back hand the board to a fresh room', async () => {
    const [first, a, b] = await pair('restart');
    for (let index = 0; index < 3; index += 1) makeNote(a, index * 90, index * -40);
    b.doc.transact(
      () => getStickyText(b.doc, makeNote(b, 400, 40))?.insert(0, 'from B'),
      LOCAL_ORIGIN,
    );
    await waitFor(() => boardsAgree([a, b]), 'the board to settle before the outage');
    const settled = JSON.stringify(snapshot(a.doc));

    // The outage: every socket closes, and the board is picked up by a room
    // that has never seen it. A new board id is a new object, which is exactly
    // the "fresh instance" the design asks for.
    a.close();
    b.close();
    expect(await socketsGone(first), 'the room to let both sockets go').toBe(true);

    const second = newBoardId();
    const aBack = await TestPeer.connect(second, { name: 'A-back', doc: replicate(a.doc) });
    await settle([aBack]);
    expect(await roomBoard(second), 'the fresh room holds A board').toBe(settled);

    const bBack = await TestPeer.connect(second, { name: 'B-back', doc: replicate(b.doc) });
    await settle([aBack, bBack]);
    await waitFor(() => boardsAgree([aBack, bBack]), 'both editors to converge again');
    expect(JSON.stringify(snapshot(bBack.doc))).toBe(settled);
    expect(await roomBoard(second)).toBe(settled);
  });
});

describe('a socket that died mid-flight is not a broken board (TC-31)', () => {
  it('keeps relaying after a send into a dead socket', async () => {
    const [board, a, b] = await pair('dead');

    // No await in between: the room may still be holding B when it broadcasts,
    // which is the case this test is about.
    b.close();
    makeNote(a, 80, 80);

    await settle([a]);
    const late = await TestPeer.connect(board, { name: 'late' });
    await settle([a, late]);

    // Nothing threw: the change is in the room, and a socket opened after the
    // incident still receives.
    expect(await roomSocketCount(board), 'only A and the newcomer are attached').toBe(2);
    makeNote(a, 240, 240);
    await waitFor(() => snapshot(late.doc).length >= 2, 'the newcomer to be updated');
    expect(snapshot(late.doc).length).toBeGreaterThanOrEqual(2);
  });
});
