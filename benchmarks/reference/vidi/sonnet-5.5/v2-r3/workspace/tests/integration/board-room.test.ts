import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';
import { rng, randomOp } from './helpers/random-ops';
import { WsClient, json, settle, sleep, waitFor } from './helpers/ws-client';

const noteId = (c: WsClient) => c.snapshot()[0].id;

async function pair() {
  const id = newBoardId();
  return { id, a: await WsClient.connect(id), b: await WsClient.connect(id) };
}

describe('BoardRoom propagation', () => {
  it('TC-07: a created note reaches B in exactly one update message', async () => {
    const { a, b } = await pair();
    const before = b.received.length;
    createSticky(a.doc, { x: 10, y: 20 });
    await waitFor(() => b.snapshot().length === 1, 'note on B');
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.received.length - before).toBe(1);
  });

  type Mutation = [string, (c: WsClient, id: string) => void];
  const mutations: Mutation[] = [
    ['move', (c, id) => moveObject(c.doc, id, 400, 500)],
    ['recolour', (c, id) => setStickyColor(c.doc, id, 'pink')],
    ['text insert', (c, id) => getStickyText(c.doc, id)!.insert(0, 'hello')],
    ['delete', (c, id) => deleteObject(c.doc, id)],
  ];
  for (const [name, mutate] of mutations) {
    it(`TC-08: ${name} reaches B and A gets no echo`, async () => {
      const { a, b } = await pair();
      createSticky(a.doc, { x: 0, y: 0 });
      await waitFor(() => b.snapshot().length === 1, 'note on B');
      const id = noteId(a);
      const aBefore = a.received.length;
      mutate(a, id);
      await waitFor(() => json(a) === json(b), `${name} on B`);
      await sleep(100);
      expect(a.received.length).toBe(aBefore);
    });
  }
});

describe('BoardRoom merging', () => {
  it('TC-09: concurrent inserts at both ends are both kept', async () => {
    const { a, b } = await pair();
    createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1, 'note on B');
    const id = noteId(a);
    getStickyText(a.doc, id)!.insert(0, 'green');
    await settle([a, b]);
    a.pause();
    b.pause();
    getStickyText(a.doc, id)!.insert(0, 'red ');
    const tb = getStickyText(b.doc, id)!;
    tb.insert(tb.length, ' blue');
    a.resume();
    b.resume();
    await waitFor(() => a.snapshot()[0].text === 'red green blue' && b.snapshot()[0].text === 'red green blue', 'merge');
  });

  it('TC-10: concurrent x writes converge to one value', async () => {
    const { a, b } = await pair();
    createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1, 'note on B');
    const id = noteId(a);
    a.pause();
    b.pause();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.resume();
    b.resume();
    await settle([a, b]);
    expect([100, 300]).toContain(a.snapshot()[0].x);
    expect(a.snapshot()[0].x).toBe(b.snapshot()[0].x);
  });

  it('TC-11: delete wins over concurrent typing and nothing is resurrected', async () => {
    const { a, b } = await pair();
    createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1, 'note on B');
    const id = noteId(a);
    a.pause();
    b.pause();
    deleteObject(a.doc, id);
    getStickyText(b.doc, id)!.insert(0, 'ghost');
    a.resume();
    b.resume();
    await settle([a, b]);
    await sleep(100);
    expect(a.snapshot()).toHaveLength(0);
    expect(b.snapshot()).toHaveLength(0);
    const late = await WsClient.connect(a.boardId);
    expect(late.snapshot()).toHaveLength(0);
    expect(JSON.stringify(late.doc.toJSON())).not.toContain('ghost');
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients x 200 seeded random ops end identical', async () => {
    const seed = Number(process.env.SEED ?? 20260901);
    console.log(`TC-12 seed ${seed}`);
    const id = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await WsClient.connect(id));
    const rands = clients.map((_, i) => rng(seed + i));
    for (let step = 0; step < 200; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i]));
      if (step % 20 === 0) await sleep(5);
    }
    await settle(clients, 15_000);
    const late = await WsClient.connect(id);
    expect(json(late)).toBe(json(clients[0]));
  });

  it('TC-14: a late joiner receives all 20 notes', async () => {
    const { id, a, b } = await pair();
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i, y: 0 }, 'blue');
      createSticky(b.doc, { x: i, y: 50 }, 'green');
    }
    await waitFor(() => a.snapshot().length === 20 && b.snapshot().length === 20, '20 notes on A and B');
    await settle([a, b]);
    const c = await WsClient.connect(id);
    expect(c.snapshot()).toHaveLength(20);
    expect(json(c)).toBe(json(a));
  });
});

describe('BoardRoom error handling', () => {
  const badFrames: [string, () => string | Uint8Array][] = [
    ['text frame', () => 'hello'],
    ['truncated bytes', () => new Uint8Array([0x80])],
    ['unknown type', () => new Uint8Array([9])],
    [
      'invalid Yjs update',
      () => {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MESSAGE_SYNC);
        encoding.writeVarUint(e, 2); // update
        encoding.writeVarUint8Array(e, new Uint8Array([255, 255, 255, 255, 255]));
        return encoding.toUint8Array(e);
      },
    ],
  ];
  for (const [name, frame] of badFrames) {
    it(`TC-15: ${name} closes only the sender with 1003`, async () => {
      const { a, b } = await pair();
      createSticky(a.doc, { x: 0, y: 0 });
      await waitFor(() => b.snapshot().length === 1, 'note on B');
      const before = json(b);
      a.ws.send(frame());
      await waitFor(() => a.closeCode !== null, 'A closed');
      expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
      expect(b.closeCode).toBeNull();
      expect(json(b)).toBe(before);
      const c = await WsClient.connect(a.boardId);
      createSticky(c.doc, { x: 5, y: 5 });
      await waitFor(() => b.snapshot().length === 2, 'B still receives updates');
      expect(json(c)).toBe(json(b));
    });
  }

  it('TC-16: awareness bytes reach sender and peers verbatim', async () => {
    const { a, b } = await pair();
    const sent = a.sendAwareness();
    await waitFor(() => a.awarenessReceived.length === 1 && b.awarenessReceived.length === 1, 'awareness');
    expect(a.awarenessReceived[0]).toEqual(sent);
    expect(b.awarenessReceived[0]).toEqual(sent);
  });

  it('TC-18: a fresh room is repopulated by the first reconnecting client, then B converges', async () => {
    const { a, b } = await pair();
    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i, y: 0 });
    await waitFor(() => b.snapshot().length === 3, 'notes on B');
    createSticky(b.doc, { x: 9, y: 9 });
    await settle([a, b]);
    a.close();
    b.close();
    // A fresh room instance is a Durable Object with a different name.
    const fresh = newBoardId();
    const docA = a.doc;
    const docB = b.doc;
    const a2 = await WsClient.connect(fresh, { autoSync: false });
    // Reuse the old docs: they carry the whole board, exactly like a browser that stayed open.
    Y.applyUpdate(a2.doc, Y.encodeStateAsUpdate(docA), 'seed');
    await a2.waitForSync();
    await waitFor(() => true, 'noop');
    const probe = await WsClient.connect(fresh);
    await waitFor(() => probe.snapshot().length === 4, 'fresh room holds A state');
    const b2 = await WsClient.connect(fresh, { autoSync: false });
    Y.applyUpdate(b2.doc, Y.encodeStateAsUpdate(docB), 'seed');
    await b2.waitForSync();
    await settle([a2, b2, probe]);
    expect(snapshot(probe.doc)).toHaveLength(4);
  });

  it('TC-31: a dead socket is dropped; the room keeps serving others', async () => {
    const { id, a, b } = await pair();
    b.ws.close(1001);
    createSticky(a.doc, { x: 1, y: 1 });
    await sleep(100);
    createSticky(a.doc, { x: 2, y: 2 });
    const c = await WsClient.connect(id);
    expect(c.snapshot()).toHaveLength(2);
    createSticky(a.doc, { x: 3, y: 3 });
    await waitFor(() => c.snapshot().length === 3, 'update reaches later socket');
    expect(a.closeCode).toBeNull();
  });
});
