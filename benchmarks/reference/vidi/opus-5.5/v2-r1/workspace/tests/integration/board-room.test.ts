import { env, runInDurableObject } from 'cloudflare:test';
import * as syncProtocol from 'y-protocols/sync';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  encodeAwareness,
  encodeUpdate,
} from '../../src/shared/protocol';
import type { BoardRoom } from '../../src/worker/board-room';
import { randomOp, seededRandom } from '../fixtures/random-ops';
import { TestClient, openSocket, waitFor } from './ws-client';

const open: TestClient[] = [];
async function connect(boardId: string, doc?: Y.Doc) {
  const client = await TestClient.connect(boardId, doc);
  open.push(client);
  return client;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

/** Snapshot of the room's own in-memory document. */
async function roomSnapshot(boardId: string) {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room: BoardRoom) => {
    const doc = room['doc'];
    return doc ? { notes: snapshot(doc), state: Y.encodeStateVector(doc) } : null;
  });
}

async function pair() {
  const boardId = newBoardId();
  const a = await connect(boardId);
  const b = await connect(boardId);
  return { boardId, a, b };
}

/** Waits until every client shows the same notes as `reference` (both may still be changing). */
async function converged(reference: TestClient, others: TestClient[]) {
  const same = () =>
    others.every((c) => JSON.stringify(c.snapshot()) === JSON.stringify(reference.snapshot()));
  await waitFor(same, 'convergence');
  for (const c of others) expect(c.snapshot()).toEqual(reference.snapshot());
}

/** Client pair sharing one note (with text `text`), fully synced. */
async function pairWithNote(text = '') {
  const p = await pair();
  const id = createSticky(p.a.doc, { x: 0, y: 0 }) as string;
  if (text) getStickyText(p.a.doc, id)!.insert(0, text);
  await converged(p.a, [p.b]);
  return { ...p, id };
}

describe('sync.room broadcast', () => {
  it('TC-07 a created note reaches the other client as exactly one update', async () => {
    const { a, b } = await pair();
    const before = b.updatesReceived;
    createSticky(a.doc, { x: 100, y: 200 }, 'pink');
    await converged(a, [b]);
    await b.roundTrip();
    expect(b.updatesReceived - before).toBe(1);
    expect(b.snapshot()[0]).toMatchObject({ color: 'pink', x: 0, y: 100 });
  });

  describe('TC-08 each change kind reaches the other client without an echo to the sender', () => {
    const cases: [string, (doc: Y.Doc, id: string) => void][] = [
      ['move', (doc, id) => moveObject(doc, id, 321, -654)],
      ['recolour', (doc, id) => setStickyColor(doc, id, 'violet')],
      ['text insert', (doc, id) => getStickyText(doc, id)!.insert(0, 'Pricing')],
      ['delete', (doc, id) => deleteObject(doc, id)],
    ];
    it.each(cases)('%s', async (_kind, mutate) => {
      const { a, b, id } = await pairWithNote();
      const aBefore = a.updatesReceived;
      const bBefore = b.updatesReceived;
      mutate(a.doc, id);
      await converged(a, [b]);
      await a.roundTrip();
      expect(b.updatesReceived).toBeGreaterThan(bBefore);
      expect(a.updatesReceived).toBe(aBefore);
    });
  });
});

describe('sync.room merging', () => {
  it('TC-09 concurrent typing at both ends of one note keeps every character', async () => {
    const { a, b, id } = await pairWithNote('green');
    // Both edits happen before either client receives the other's change.
    getStickyText(a.doc, id)!.insert(0, 'red ');
    const bText = getStickyText(b.doc, id)!;
    bText.insert(bText.length, ' blue');
    await converged(a, [b]);
    expect(a.snapshot()[0].text).toBe('red green blue');
    expect(b.snapshot()[0].text).toBe('red green blue');
  });

  it('TC-10 concurrent moves of one note settle on the same x everywhere', async () => {
    const { boardId, a, b, id } = await pairWithNote();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    await converged(a, [b]);
    const x = a.snapshot()[0].x;
    expect([100, 300]).toContain(x);
    expect(b.snapshot()[0].x).toBe(x);
    await expect.poll(async () => (await roomSnapshot(boardId))?.notes[0].x).toBe(x);
  });

  it('TC-11 a delete wins over concurrent typing and the note is not resurrected', async () => {
    const { boardId, a, b, id } = await pairWithNote('green');
    expect(() => {
      deleteObject(a.doc, id);
      getStickyText(b.doc, id)!.insert(0, 'resurrect ');
      moveObject(b.doc, id, 999, 999);
    }).not.toThrow();
    await converged(a, [b]);
    await a.roundTrip();
    await b.roundTrip();
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
    expect((await roomSnapshot(boardId))?.notes).toEqual([]);
    for (const doc of [a.doc, b.doc]) {
      expect(doc.getMap('objects').has(id)).toBe(false);
      expect(JSON.stringify(doc.toJSON())).not.toContain('resurrect');
    }
  });

  it('TC-12 MAX_CONCURRENT_EDITORS clients x 200 seeded random ops converge', async () => {
    const seed = Date.now() % 1_000_000;
    console.log(`TC-12 random-ops seed: ${seed}`);
    const boardId = newBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await connect(boardId));
    const rands = clients.map((_, i) => seededRandom(seed + i));
    for (let step = 0; step < 200; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i]));
      // Let some messages interleave with further local edits.
      if (step % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    for (const c of clients) await c.roundTrip();
    await converged(clients[0], clients.slice(1));
    const room = await roomSnapshot(boardId);
    expect(room?.notes).toEqual(clients[0].snapshot());
  });

  it('TC-14 a late joiner sees all notes with their text, colour and position', async () => {
    const { boardId, a, b } = await pair();
    for (let i = 0; i < 10; i++) {
      const idA = createSticky(a.doc, { x: i * 220, y: 0 }, 'green') as string;
      getStickyText(a.doc, idA)!.insert(0, `A note ${i}`);
      const idB = createSticky(b.doc, { x: i * 220, y: 300 }, 'blue') as string;
      getStickyText(b.doc, idB)!.insert(0, `B note ${i}`);
    }
    await converged(a, [b]);
    const c = await connect(boardId);
    expect(c.snapshot()).toHaveLength(20);
    expect(c.snapshot()).toEqual(a.snapshot());
  });
});

describe('sync.room errors and relay', () => {
  const invalidFrames: [string, () => string | Uint8Array][] = [
    ['a text frame', () => 'hello'],
    [
      'truncated bytes',
      () => {
        const doc = new Y.Doc();
        doc.getText('t').insert(0, 'truncated');
        const full = encodeUpdate(Y.encodeStateAsUpdate(doc));
        return full.slice(0, full.length - 4);
      },
    ],
    ['an unknown message type', () => new Uint8Array([9, 1, 0])],
    ['an invalid Yjs update', () => encodeUpdate(new Uint8Array([200, 200, 200, 200, 200]))],
  ];

  it.each(invalidFrames)('TC-15 %s closes only the sender and leaves the doc unchanged', async (_label, make) => {
    const { boardId, a, b, id } = await pairWithNote('keep me');
    const before = await roomSnapshot(boardId);
    a.ws.send(make());
    await waitFor(() => a.closeCode !== null, 'sender closed');
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

    expect(b.isOpen).toBe(true);
    const c = await connect(boardId);
    setStickyColor(c.doc, id, 'orange');
    await expect.poll(() => b.snapshot()[0].color).toBe('orange');

    const after = await roomSnapshot(boardId);
    expect(after?.notes.map((n) => n.text)).toEqual(before?.notes.map((n) => n.text));
    expect(after?.notes[0].color).toBe('orange');
  });

  it('TC-16 awareness bytes are relayed verbatim to everyone including the sender', async () => {
    const { a, b } = await pair();
    const payload = new Uint8Array([1, 42, 7, 3, 99, 5]);
    const frame = encodeAwareness(payload);
    const isFrame = (f: Uint8Array) =>
      f[0] === MESSAGE_AWARENESS && f.length === frame.length && f.every((v, i) => v === frame[i]);
    a.ws.send(frame);
    await waitFor(() => a.received.some(isFrame) && b.received.some(isFrame), 'awareness relay');
  });

  it('TC-18 after a restart the first reconnecting client repopulates the room and others converge', async () => {
    const { a, b } = await pair();
    createSticky(a.doc, { x: 0, y: 0 }, 'orange');
    createSticky(b.doc, { x: 500, y: 0 }, 'violet');
    await converged(a, [b]);
    // Restart: every socket closes; the replacement room instance starts empty.
    a.close(1012);
    b.close(1012);
    // B keeps editing while disconnected.
    createSticky(b.doc, { x: 900, y: 0 }, 'blue');

    const fresh = newBoardId();
    expect(await roomSnapshot(fresh)).toBeNull();
    const a2 = await connect(fresh, a.doc);
    await expect.poll(async () => (await roomSnapshot(fresh))?.notes).toEqual(snapshot(a.doc));
    const b2 = await connect(fresh, b.doc);
    await converged(b2, [a2]);
    expect(a2.snapshot()).toHaveLength(3);
    expect((await roomSnapshot(fresh))?.notes).toEqual(b2.snapshot());
  });

  it('TC-31 a dead socket does not break broadcasting to the others', async () => {
    const boardId = newBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    const c = await connect(boardId);
    b.close(1001);
    createSticky(a.doc, { x: 0, y: 0 });
    createSticky(a.doc, { x: 300, y: 0 });
    await converged(a, [c]);
    const d = await connect(boardId);
    expect(d.snapshot()).toEqual(a.snapshot());
    createSticky(d.doc, { x: 600, y: 0 });
    await converged(d, [a, c]);
  });
});

describe('sync.room handshake', () => {
  it('sends SyncStep1 to a newly accepted socket', async () => {
    const { ws } = await openSocket(newBoardId());
    const first = await new Promise<Uint8Array>((resolve) =>
      ws.addEventListener('message', (e) => resolve(new Uint8Array(e.data as ArrayBuffer)), {
        once: true,
      }),
    );
    expect(first[0]).toBe(MESSAGE_SYNC);
    expect(first[1]).toBe(syncProtocol.messageYjsSyncStep1);
    ws.close();
  });
});
