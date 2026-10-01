import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, deleteObject, getStickyText, moveObject, setStickyColor } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { randomOp, rng } from './random-ops';
import { WsClient, converge, sleep, waitFor } from './ws-client';

async function pair() {
  const id = newBoardId();
  const a = await WsClient.connect(id);
  const b = await WsClient.connect(id);
  return { id, a, b };
}

const settle = () => sleep(150);

describe('BoardRoom broadcast', () => {
  it('TC-07: a created note reaches B in exactly one update', async () => {
    const { a, b } = await pair();
    const before = b.received.length;
    const id = createSticky(a.doc, { x: 5, y: 6 });
    await waitFor(() => b.snapshot().some((n) => n.id === id), 'note on B');
    await settle();
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.received.length - before).toBe(1);
  });

  describe('TC-08: each change kind reaches B, A gets no echo', () => {
    const cases: [string, (a: WsClient, id: string) => void][] = [
      ['move', (a, id) => moveObject(a.doc, id, 321, 123)],
      ['recolour', (a, id) => setStickyColor(a.doc, id, 'pink')],
      ['text insert', (a, id) => getStickyText(a.doc, id)!.insert(0, 'hello')],
      ['delete', (a, id) => deleteObject(a.doc, id)],
    ];
    it.each(cases)('%s', async (_name, mutate) => {
      const { a, b } = await pair();
      const id = createSticky(a.doc, { x: 1, y: 1 });
      await waitFor(() => b.snapshot().length === 1, 'initial note');
      await settle();
      const echoBefore = a.received.length;
      mutate(a, id);
      await converge([a, b]);
      await settle();
      expect(b.snapshot()).toEqual(a.snapshot());
      expect(a.received.length).toBe(echoBefore);
    });
  });
});

describe('BoardRoom merging', () => {
  it('TC-09: concurrent text inserts are both kept', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    getStickyText(a.doc, id)!.insert(0, 'green');
    await converge([a, b]);
    // Both edit before either sees the other's change.
    getStickyText(a.doc, id)!.insert(0, 'red ');
    getStickyText(b.doc, id)!.insert(5, ' blue');
    await converge([a, b]);
    expect(a.snapshot()[0].text).toBe('red green blue');
    expect(b.snapshot()[0].text).toBe('red green blue');
  });

  it('TC-10: concurrent x writes settle to the same value', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    await converge([a, b]);
    expect(a.snapshot()[0].x).toBe(b.snapshot()[0].x);
    expect([100, 300]).toContain(a.snapshot()[0].x);
  });

  it('TC-11: delete beats concurrent typing; the note is not resurrected', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    deleteObject(a.doc, id);
    getStickyText(b.doc, id)!.insert(0, 'ghost');
    moveObject(b.doc, id, 9, 9);
    await converge([a, b]);
    expect(a.snapshot()).toHaveLength(0);
    expect(b.snapshot()).toHaveLength(0);
    expect(a.json()).not.toContain('ghost');
    expect(b.json()).not.toContain('ghost');
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients × 200 seeded random ops converge', async () => {
    const seed = Number(process.env.SEED ?? Date.now() % 100000);
    console.log(`TC-12 seed=${seed}`);
    const id = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await WsClient.connect(id));
    const rands = clients.map((_, i) => rng(seed + i));
    for (let round = 0; round < 200; round++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i]));
      if (round % 20 === 0) await sleep(5);
    }
    await converge(clients, 15000);
    const first = clients[0].snapshot();
    for (const c of clients) expect(c.snapshot()).toEqual(first);
  });

  it('TC-14: late joiner sees all 20 notes', async () => {
    const { id, a, b } = await pair();
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i, y: 0 });
      createSticky(b.doc, { x: i, y: 100 });
    }
    await converge([a, b]);
    expect(a.snapshot()).toHaveLength(20);
    const c = await WsClient.connect(id);
    expect(c.snapshot()).toEqual(a.snapshot());
  });
});

describe('BoardRoom error handling', () => {
  const bad: [string, (c: WsClient) => void][] = [
    ['text frame', (c) => c.sendRaw('hello')],
    ['truncated bytes', (c) => c.sendBytes(new Uint8Array([0x80]))],
    ['unknown type', (c) => c.sendBytes(new Uint8Array([9, 1, 2]))],
    [
      'invalid Yjs update',
      (c) => {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MESSAGE_SYNC);
        syncProtocol.writeUpdate(e, new Uint8Array([255, 255, 255, 1, 2, 3]));
        c.sendBytes(encoding.toUint8Array(e));
      },
    ],
  ];
  it.each(bad)('TC-15: %s closes only the sender', async (_n, send) => {
    const { id: boardId, a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    const docBefore = b.json();
    send(a);
    await waitFor(() => a.closeCode !== null, 'A closed');
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(b.isOpen).toBe(true);
    expect(b.json()).toBe(docBefore);
    const c = await WsClient.connect(boardId);
    expect(c.json()).toBe(docBefore);
    moveObject(c.doc, id, 77, 77);
    await waitFor(() => b.snapshot()[0].x === 77, 'B still receives updates');
  });

  it('TC-16: awareness bytes reach sender and others identically', async () => {
    const { a, b } = await pair();
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(e, new Uint8Array([1, 2, 3, 4]));
    const frame = encoding.toUint8Array(e);
    const find = (c: WsClient) => c.received.find((m) => m[0] === MESSAGE_AWARENESS);
    a.sendBytes(frame);
    await waitFor(() => !!find(a) && !!find(b), 'awareness on both');
    expect(Array.from(find(a)!)).toEqual(Array.from(frame));
    expect(Array.from(find(b)!)).toEqual(Array.from(frame));
  });

  it('TC-18: fresh room is repopulated by the first reconnecting client, then the other converges', async () => {
    const oldId = newBoardId();
    const a = await WsClient.connect(oldId);
    const b = await WsClient.connect(oldId);
    createSticky(a.doc, { x: 1, y: 1 });
    createSticky(b.doc, { x: 2, y: 2 });
    await converge([a, b]);
    a.close();
    b.close();
    // New board id → new object id → fresh instance with an empty doc.
    const fresh = newBoardId();
    const a2 = await WsClient.connect(fresh, { doc: a.doc });
    const b2 = await WsClient.connect(fresh, { doc: b.doc });
    const probe = await WsClient.connect(fresh);
    await converge([a2, b2, probe]);
    expect(probe.snapshot()).toHaveLength(2);
    expect(probe.snapshot()).toEqual(a.snapshot());
  });

  it('TC-31: a dead socket does not break broadcasting', async () => {
    const { id, a, b } = await pair();
    b.close();
    createSticky(a.doc, { x: 0, y: 0 });
    createSticky(a.doc, { x: 1, y: 1 });
    await settle();
    expect(a.isOpen).toBe(true);
    const c = await WsClient.connect(id);
    expect(c.snapshot()).toHaveLength(2);
    createSticky(a.doc, { x: 2, y: 2 });
    await waitFor(() => c.snapshot().length === 3, 'later socket still receives');
  });
});

