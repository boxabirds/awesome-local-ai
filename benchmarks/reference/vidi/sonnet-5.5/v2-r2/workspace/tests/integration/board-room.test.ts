import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky, deleteObject, getStickyText, moveObject, setStickyColor,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { randomOp, seeded } from './helpers/random-ops';
import { WsClient, connectAll, converged, eventually } from './helpers/ws-client';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('BoardRoom', () => {
  it('TC-07: a created note reaches B with exactly one update', async () => {
    const [a, b] = await connectAll(newBoardId(), 2);
    const before = b.updatesReceived;
    createSticky(a.doc, { x: 5, y: 5 });
    await converged([a, b]);
    expect(b.snapshot()).toHaveLength(1);
    expect(b.updatesReceived - before).toBe(1);
  });

  describe('TC-08: each operation propagates without echo', () => {
    const ops: [string, (a: WsClient, id: string) => void][] = [
      ['move', (a, id) => { moveObject(a.doc, id, 400, 500); }],
      ['recolour', (a, id) => { setStickyColor(a.doc, id, 'pink'); }],
      ['text insert', (a, id) => { getStickyText(a.doc, id)!.insert(0, 'hello'); }],
      ['delete', (a, id) => { deleteObject(a.doc, id); }],
    ];
    for (const [name, op] of ops) {
      it(name, async () => {
        const [a, b] = await connectAll(newBoardId(), 2);
        const id = createSticky(a.doc, { x: 0, y: 0 });
        await converged([a, b]);
        const aBefore = a.updatesReceived;
        const bBefore = b.updatesReceived;
        op(a, id);
        await converged([a, b]);
        await pause(100);
        expect(b.updatesReceived - bBefore).toBe(1);
        expect(a.updatesReceived).toBe(aBefore);
      });
    }
  });

  it('TC-09: concurrent inserts are both kept', async () => {
    const [a, b] = await connectAll(newBoardId(), 2);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await converged([a, b]);
    getStickyText(a.doc, id)!.insert(0, 'green');
    await converged([a, b]);
    // Cut b off from a's changes by applying both edits locally before the network delivers them.
    const ta = getStickyText(a.doc, id)!;
    const tb = getStickyText(b.doc, id)!;
    a.doc.transact(() => ta.insert(0, 'red '), 'local');
    b.doc.transact(() => tb.insert(tb.length, ' blue'), 'local');
    await eventually(() => ta.toString() === 'red green blue' && tb.toString() === 'red green blue');
  });

  it('TC-10: concurrent moves settle to one value', async () => {
    const [a, b] = await connectAll(newBoardId(), 2);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await converged([a, b]);
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    await converged([a, b]);
    const x = a.snapshot()[0].x;
    expect([100, 300]).toContain(x);
    expect(b.snapshot()[0].x).toBe(x);
  });

  it('TC-11: delete wins over a concurrent text insert', async () => {
    const [a, b] = await connectAll(newBoardId(), 2);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await converged([a, b]);
    deleteObject(a.doc, id);
    getStickyText(b.doc, id)?.insert(0, 'ghost');
    await converged([a, b]);
    await pause(100);
    for (const c of [a, b]) {
      expect(c.snapshot()).toHaveLength(0);
      expect(JSON.stringify(c.doc.toJSON())).not.toContain('ghost');
    }
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients x 200 random ops converge', async () => {
    const seed = Number(process.env.SEED ?? Date.now() % 100000);
    console.log(`TC-12 seed ${seed}`);
    const clients = await connectAll(newBoardId(), MAX_CONCURRENT_EDITORS);
    const rands = clients.map((_, i) => seeded(seed + i));
    for (let step = 0; step < 200; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i]));
      if (step % 20 === 0) await pause(5);
    }
    await converged(clients);
    expect(clients[0].snapshot().length).toBeGreaterThan(0);
  });

  it('TC-13/TC-14: late joiner sees all 20 notes', async () => {
    const id = newBoardId();
    const [a, b] = await connectAll(id, 2);
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 10, y: 0 });
      createSticky(b.doc, { x: 0, y: i * 10 });
    }
    await converged([a, b]);
    const c = await WsClient.connect(id);
    await c.waitForSync();
    await converged([a, b, c]);
    expect(c.snapshot()).toHaveLength(20);
  });

  describe('TC-15: malformed traffic closes only the sender', () => {
    const encode = (f: (e: encoding.Encoder) => void) => {
      const e = encoding.createEncoder();
      f(e);
      return encoding.toUint8Array(e);
    };
    const cases: [string, string | Uint8Array][] = [
      ['text frame', 'hello'],
      ['truncated bytes', new Uint8Array([0x80])],
      ['unknown type', encode((e) => encoding.writeVarUint(e, 9))],
      ['invalid yjs update', encode((e) => {
        encoding.writeVarUint(e, MESSAGE_SYNC);
        encoding.writeVarUint(e, 2);
        encoding.writeVarUint8Array(e, new Uint8Array([255, 255, 255, 255, 1, 2, 3]));
      })],
    ];
    for (const [name, payload] of cases) {
      it(name, async () => {
        const id = newBoardId();
        const [a, b] = await connectAll(id, 2);
        createSticky(a.doc, { x: 0, y: 0 });
        await converged([a, b]);
        const before = JSON.stringify(Y.encodeStateVector(b.doc));
        a.sendRaw(payload);
        await eventually(() => a.closeCode !== null);
        expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
        expect(b.closeCode).toBeNull();
        expect(JSON.stringify(Y.encodeStateVector(b.doc))).toBe(before);
        // The room doc is unchanged: a fresh client sees exactly B's view.
        const probe = await WsClient.connect(id);
        await probe.waitForSync();
        expect(probe.snapshot()).toEqual(b.snapshot());
        // B still receives updates from others.
        createSticky(probe.doc, { x: 1, y: 1 });
        await eventually(() => b.snapshot().length === 2);
      });
    }
  });

  it('TC-16: awareness bytes reach sender and peers verbatim', async () => {
    const [a, b] = await connectAll(newBoardId(), 2);
    const frame = encode2(MESSAGE_AWARENESS, [1, 2, 3, 4]);
    a.sendRaw(frame);
    await eventually(() => a.awarenessReceived.length === 1 && b.awarenessReceived.length === 1);
    expect([...a.awarenessReceived[0]]).toEqual([...frame]);
    expect([...b.awarenessReceived[0]]).toEqual([...frame]);
  });

  it('TC-18: a fresh room is repopulated by the first reconnecting client', async () => {
    const first = newBoardId();
    const [a, b] = await connectAll(first, 2);
    createSticky(a.doc, { x: 1, y: 1 });
    createSticky(b.doc, { x: 2, y: 2 });
    await converged([a, b]);
    a.close();
    b.close();
    // Fresh object instance (new name) stands in for a restarted room.
    const fresh = newBoardId();
    const a2 = await WsClient.connect(fresh, a.doc);
    await a2.waitForSync();
    const b2 = await WsClient.connect(fresh, b.doc);
    await b2.waitForSync();
    await converged([a2, b2]);
    const probe = await WsClient.connect(fresh);
    await probe.waitForSync();
    expect(probe.snapshot()).toEqual(a.snapshot());
    expect(probe.snapshot()).toHaveLength(2);
  });

  it('TC-31: a dead socket does not break the room', async () => {
    const id = newBoardId();
    const [a, b] = await connectAll(id, 2);
    b.ws.close(1001);
    createSticky(a.doc, { x: 0, y: 0 });
    await pause(50);
    createSticky(a.doc, { x: 5, y: 5 });
    const c = await WsClient.connect(id);
    await c.waitForSync();
    expect(c.snapshot()).toHaveLength(2);
    createSticky(a.doc, { x: 9, y: 9 });
    await eventually(() => c.snapshot().length === 3);
  });
});

function encode2(type: number, body: number[]): Uint8Array {
  return new Uint8Array([type, ...body]);
}
