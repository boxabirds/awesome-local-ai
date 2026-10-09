// Task 6: BoardRoom merging, broadcast, restart and error handling
// (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import {
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { TestClient, createNote, snapshotString } from './helpers/ws-client';

async function pair(): Promise<[TestClient, TestClient, string]> {
  const boardId = newBoardId();
  const a = await TestClient.connect(boardId);
  const b = await TestClient.connect(boardId);
  return [a, b, boardId];
}

describe('BoardRoom broadcast', () => {
  it('TC-07: A creates a sticky -> B snapshot equals A; B received exactly one update', async () => {
    const [a, b] = await pair();
    createNote(a, 40, 60);
    await b.waitFor(() => b.snapshot().length === 1, 10_000, 'B to receive the note');
    expect(b.updateCount()).toBe(1);
    expect(snapshotString(b)).toBe(snapshotString(a));
    a.destroy();
    b.destroy();
  });

  it.each([
    ['move', (doc: Y.Doc, id: string) => moveObject(doc, id, 123, -45)],
    ['recolour', (doc: Y.Doc, id: string) => setStickyColor(doc, id, 'blue')],
    [
      'text insert',
      (doc: Y.Doc, id: string) => getStickyText(doc, id)?.insert(0, 'hello'),
    ],
    ['delete', (doc: Y.Doc, id: string) => deleteObject(doc, id)],
  ])('TC-08: %s on A -> B equals A; A receives no echo', async (_op, mutate) => {
    const [a, b] = await pair();
    const id = createNote(a, 0, 0);
    await b.waitFor(() => b.snapshot().length === 1, 10_000, 'initial sync');
    const echoBefore = a.updateCount();
    a.local(() => mutate(a.doc, id));
    if (_op === 'delete') {
      await b.waitFor(() => b.snapshot().length === 0, 10_000, 'deletion to arrive');
    } else {
      await b.waitFor(() => snapshotString(b) === snapshotString(a), 10_000, _op);
    }
    expect(a.updateCount()).toBe(echoBefore);
    expect(snapshotString(b)).toBe(snapshotString(a));
    a.destroy();
    b.destroy();
  });

  it('TC-09: concurrent text edits merge to the same string on both', async () => {
    const [a, b] = await pair();
    const id = createNote(a, 0, 0);
    a.local(() => getStickyText(a.doc, id)?.insert(0, 'green'));
    await b.waitFor(() => snapshotString(b) === snapshotString(a), 10_000, 'seed text');

    // Concurrent: neither side has seen the other's insert yet.
    a.pause();
    a.local(() => getStickyText(a.doc, id)?.insert(0, 'red '));
    b.pause();
    b.local(() => getStickyText(b.doc, id)?.insert(5, ' blue'));
    a.resumeAndFlush();
    b.resumeAndFlush();

    const textOf = (c: TestClient) => getStickyText(c.doc, id)?.toString() ?? '';
    await a.waitFor(
      () => textOf(a) === 'red green blue' && textOf(b) === 'red green blue',
      10_000,
      'converged text',
    );
    expect(snapshotString(b)).toBe(snapshotString(a));
    a.destroy();
    b.destroy();
  });

  it('TC-10: concurrent position writes converge to an identical x', async () => {
    const [a, b] = await pair();
    const id = createNote(a, 0, 0);
    await b.waitFor(() => b.snapshot().length === 1, 10_000, 'initial sync');
    a.pause();
    a.local(() => moveObject(a.doc, id, 100, 0));
    b.pause();
    b.local(() => moveObject(b.doc, id, 300, 0));
    a.resumeAndFlush();
    b.resumeAndFlush();
    await a.waitFor(
      () => JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()),
      10_000,
      'identical snapshots',
    );
    expect(a.snapshot()[0]?.x).toBe(b.snapshot()[0]?.x);
    a.destroy();
    b.destroy();
  });

  it('TC-11: delete vs concurrent text insert -> note gone everywhere, no resurrection', async () => {
    const [a, b, boardId] = await pair();
    const id = createNote(a, 0, 0);
    await b.waitFor(() => b.snapshot().length === 1, 10_000, 'initial sync');
    a.pause();
    a.local(() => deleteObject(a.doc, id));
    b.pause();
    b.local(() => getStickyText(b.doc, id)?.insert(0, 'typed after deletion'));
    a.resumeAndFlush();
    b.resumeAndFlush();
    await a.waitFor(
      () => a.snapshot().length === 0 && b.snapshot().length === 0,
      10_000,
      'deletion to win on both',
    );
    // The room document (visible to a fresh joiner) has neither the note nor
    // the text written into its deleted Y.Text.
    const late = await TestClient.connect(boardId);
    expect(late.snapshot()).toHaveLength(0);
    a.destroy();
    b.destroy();
    late.destroy();
  });
});

describe('BoardRoom capacity and late join', () => {
  it('TC-12: MAX_CONCURRENT_EDITORS clients × 200 seeded random ops -> identical snapshots', async () => {
    const seed = Date.now() % 0x1_0000_0000;
    console.log(`TC-12 seed: ${seed}`);
    let state = seed;
    const rand = () => {
      // mulberry32
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const boardId = newBoardId();
    const clients = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => TestClient.connect(boardId)),
    );
    const noteIds: string[] = [];
    const colors = Object.keys(STICKY_COLORS) as StickyColor[];
    for (const client of clients) {
      for (let op = 0; op < 200; op += 1) {
        const pick = rand();
        if (pick < 0.4 || noteIds.length === 0) {
          noteIds.push(createNote(client, Math.round(rand() * 1000), Math.round(rand() * 1000)));
        } else {
          const id = noteIds[Math.floor(rand() * noteIds.length)];
          if (pick < 0.6) client.local(() => moveObject(client.doc, id, rand() * 500, rand() * 500));
          else if (pick < 0.75)
            client.local(() => setStickyColor(client.doc, id, colors[Math.floor(rand() * colors.length)]));
          else if (pick < 0.9) client.local(() => getStickyText(client.doc, id)?.insert(0, 'x'));
          else client.local(() => deleteObject(client.doc, id));
        }
      }
    }
    await clients[0].waitFor(
      () => clients.every((c) => snapshotString(c) === snapshotString(clients[0])),
      30_000,
      'all clients to converge',
    );
    for (const client of clients.slice(1)) {
      expect(snapshotString(client)).toBe(snapshotString(clients[0]));
    }
    for (const client of clients) client.destroy();
  });

  it('TC-14: 40 notes from two editors -> late joiner C matches after sync', async () => {
    const [a, b] = await pair();
    for (let i = 0; i < 20; i += 1) createNote(a, i * 10, 0);
    for (let i = 0; i < 20; i += 1) createNote(b, 0, i * 10);
    await a.waitFor(() => a.snapshot().length === 40, 10_000, 'A to see all notes');
    await b.waitFor(() => snapshotString(b) === snapshotString(a), 10_000, 'A/B to converge');
    const late = await TestClient.connect(a.boardId);
    await late.waitFor(() => late.snapshot().length === 40, 10_000, 'C to receive all notes');
    expect(snapshotString(late)).toBe(snapshotString(a));
    a.destroy();
    b.destroy();
    late.destroy();
  });
});

describe('BoardRoom robustness', () => {
  const malformed: Array<[string, () => Uint8Array | string]> = [
    ['text frame', () => 'hello'],
    ['truncated sync bytes', () => new Uint8Array([0, 0])],
    ['unknown message type', () => new Uint8Array([9, 0, 0])],
    [
      'invalid Yjs update',
      () => new Uint8Array([0, 2, 3, 1, 2, 3]), // sync update, 3 bytes of garbage
    ],
  ];

  it.each(malformed)(
    'TC-15: %s -> sender closed 1003, others unaffected, room doc unchanged',
    async (_label, frame) => {
      const [a, b] = await pair(); // a exists only to remember the board below
      const boardId = a.boardId;
      a.close();
      await a.waitForClosed();

      const offender = await TestClient.connect(boardId);
      offender.sendRaw(frame());
      expect(await offender.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);

      // B stays open and still receives updates from a fresh writer.
      const writer = await TestClient.connect(boardId);
      createNote(writer, 7, 7);
      await b.waitFor(() => b.snapshot().length === 1, 10_000, 'B to still receive');

      // The room document is untouched by the malformed traffic.
      const probe = await TestClient.connect(boardId);
      expect(probe.snapshot()).toHaveLength(1);
      offender.destroy();
      writer.destroy();
      probe.destroy();
      b.destroy();
    },
  );

  it('TC-16: awareness bytes from A are relayed verbatim to A and B', async () => {
    const [a, b] = await pair();
    const frame = new Uint8Array([1, 3, 9, 8, 7]);
    a.sendRaw(frame);
    await a.waitFor(() => a.received.some((f) => f.kind === 'awareness'), 10_000, 'A echo');
    await b.waitFor(() => b.received.some((f) => f.kind === 'awareness'), 10_000, 'B copy');
    const frameOf = (c: TestClient) =>
      c.received.find((f) => f.kind === 'awareness')?.bytes ?? new Uint8Array();
    expect(Array.from(frameOf(a))).toEqual(Array.from(frame));
    expect(Array.from(frameOf(b))).toEqual(Array.from(frame));
    a.destroy();
    b.destroy();
  });

  it('TC-18: after total disconnect, reconnecting to a fresh room repopulates it; late B converges', async () => {
    const boardId = newBoardId();
    const a1 = await TestClient.connect(boardId);
    const b1 = await TestClient.connect(boardId);
    createNote(a1, 3, 4);
    await b1.waitFor(() => b1.snapshot().length === 1, 10_000, 'B to see note');
    // "restart": every socket closes, the room object id is fresh.
    a1.close();
    b1.close();
    await a1.waitForClosed();
    await b1.waitForClosed();

    const freshBoard = newBoardId();
    const a2 = await TestClient.connect(freshBoard, a1.doc);
    // The fresh room answered A's SyncStep2 with A's content; a probe sees it.
    const probe = await TestClient.connect(freshBoard);
    await probe.waitFor(() => probe.snapshot().length === 1, 10_000, 'probe to see the note');
    expect(snapshotString(probe)).toBe(snapshotString(a2));

    // B (empty doc) joins the fresh room and converges to A.
    const b2 = await TestClient.connect(freshBoard);
    await b2.waitFor(() => snapshotString(b2) === snapshotString(a2), 10_000, 'B to converge');
    a1.destroy();
    a2.destroy();
    b1.destroy();
    b2.destroy();
    probe.destroy();
  });

  it('TC-31: socket closed abruptly -> room stays healthy for later sockets', async () => {
    const [a, b] = await pair();
    b.close();
    // Let the room notice before the next write hits the dead socket.
    await new Promise((resolve) => setTimeout(resolve, 50));
    createNote(a, 1, 1); // must not throw; room relays to whoever remains
    const later = await TestClient.connect(a.boardId);
    await later.waitFor(() => later.snapshot().length === 1, 10_000, 'later socket to receive');
    expect(snapshotString(later)).toBe(snapshotString(a));
    a.destroy();
    b.destroy();
    later.destroy();
  });
});
