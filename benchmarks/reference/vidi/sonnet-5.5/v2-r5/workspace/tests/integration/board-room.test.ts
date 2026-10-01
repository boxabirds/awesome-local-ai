import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import { newBoardId } from '../../src/shared/board-id';
import {
  LOCAL_ORIGIN, createSticky, deleteObject, getStickyText, moveObject, setStickyColor,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { randomOp, mulberry32, type OpLog } from './helpers/random-ops';
import { WsClient, converge, settle, waitUntil } from './helpers/ws-client';

async function pair(id = newBoardId()): Promise<[WsClient, WsClient, string]> {
  const a = await WsClient.connect(id);
  const b = await WsClient.connect(id);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  return [a, b, id];
}

const text = (c: WsClient, id: string) => getStickyText(c.doc, id)!;
const type = (c: WsClient, id: string, at: number, s: string) =>
  c.doc.transact(() => text(c, id).insert(at, s), LOCAL_ORIGIN);

describe('BoardRoom (sync.room)', () => {
  it('TC-07 create reaches B with exactly one update', async () => {
    const [a, b] = await pair();
    const before = b.updatesReceived;
    createSticky(a.doc, { x: 100, y: 100 });
    await converge([a, b]);
    expect(b.snapshot()).toHaveLength(1);
    expect(b.updatesReceived - before).toBe(1);
    a.close(); b.close();
  });

  describe('TC-08 each operation kind reaches B without echoing to A', () => {
    const ops: Array<[string, (c: WsClient, id: string) => void, (s: ReturnType<WsClient['snapshot']>) => boolean]> = [
      ['move', (c, id) => { moveObject(c.doc, id, 500, 600); }, (s) => s[0]?.x === 500 && s[0]?.y === 600],
      ['recolour', (c, id) => { setStickyColor(c.doc, id, 'pink'); }, (s) => s[0]?.color === 'pink'],
      ['text insert', (c, id) => type(c, id, 0, 'hello'), (s) => s[0]?.text === 'hello'],
      ['delete', (c, id) => { deleteObject(c.doc, id); }, (s) => s.length === 0],
    ];
    for (const [name, op, check] of ops) {
      it(name, async () => {
        const [a, b] = await pair();
        const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
        await converge([a, b]);
        await waitUntil(() => b.snapshot().length === 1);
        const echoBefore = a.updatesReceived;
        op(a, id);
        await waitUntil(() => check(b.snapshot()), 10_000, `${name} on B`);
        await converge([a, b]);
        await settle();
        expect(a.updatesReceived).toBe(echoBefore);
        a.close(); b.close();
      });
    }
  });

  it('TC-09 concurrent text inserts are all kept', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await waitUntil(() => b.snapshot().length === 1);
    type(a, id, 0, 'green');
    await waitUntil(() => text(b, id).toString() === 'green');
    a.pause(); b.pause();
    type(a, id, 0, 'red ');
    type(b, id, 5, ' blue');
    a.resume(); b.resume();
    await waitUntil(() => text(a, id).toString() === 'red green blue' && text(b, id).toString() === 'red green blue');
    a.close(); b.close();
  });

  it('TC-10 concurrent x=100 vs x=300 converge to one value', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await waitUntil(() => b.snapshot().length === 1);
    a.pause(); b.pause();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.resume(); b.resume();
    await settle();
    await converge([a, b]);
    expect([100, 300]).toContain(a.snapshot()[0].x);
    expect(b.snapshot()[0].x).toBe(a.snapshot()[0].x);
    a.close(); b.close();
  });

  it('TC-11 delete wins over concurrent typing', async () => {
    const [a, b, id] = await pair();
    const note = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await waitUntil(() => b.snapshot().length === 1);
    a.pause(); b.pause();
    deleteObject(a.doc, note);
    expect(() => type(b, note, 0, 'ghost')).not.toThrow();
    a.resume(); b.resume();
    await waitUntil(() => a.snapshot().length === 0 && b.snapshot().length === 0);
    await settle();
    const c = await WsClient.connect(id);
    await c.waitForSync();
    await settle();
    expect(a.snapshot()).toHaveLength(0);
    expect(b.snapshot()).toHaveLength(0);
    expect(c.snapshot()).toHaveLength(0);
    expect(c.doc.getMap('objects').size).toBe(0);
    a.close(); b.close(); c.close();
  });
});

describe('BoardRoom at scale and under failure', () => {
  it('TC-12 MAX_CONCURRENT_EDITORS clients × 200 seeded ops converge', async () => {
    const seed = 20240601;
    console.log(`TC-12 seed ${seed}`);
    const id = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await WsClient.connect(id));
    await Promise.all(clients.map((c) => c.waitForSync()));
    const log: OpLog = { created: new Set(), deleted: new Set() };
    const rnds = clients.map((_, i) => mulberry32(seed + i));
    for (let step = 0; step < 200; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rnds[i], log));
      if (step % 10 === 0) await settle(5);
    }
    await converge(clients, 20_000);
    await settle(300);
    await converge(clients, 20_000);
    const ids = new Set(clients[0].snapshot().map((n) => n.id));
    for (const created of log.created) expect(ids.has(created)).toBe(!log.deleted.has(created));
    clients.forEach((c) => c.close());
  });

  it('TC-14 late joiner receives the whole board', async () => {
    const [a, b, id] = await pair();
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 10, y: 0 });
      createSticky(b.doc, { x: 0, y: i * 10 });
    }
    await waitUntil(() => a.snapshot().length === 20 && b.snapshot().length === 20);
    await converge([a, b]);
    const c = await WsClient.connect(id);
    await c.waitForSync();
    await converge([a, c]);
    expect(c.snapshot()).toHaveLength(20);
    a.close(); b.close(); c.close();
  });

  describe('TC-15 malformed traffic closes only the sender', () => {
    const bad: Array<[string, () => string | Uint8Array]> = [
      ['text frame', () => 'hello'],
      ['truncated bytes', () => new Uint8Array([0x80])],
      ['unknown type', () => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 9); encoding.writeVarUint(e, 1); return encoding.toUint8Array(e); }],
      ['invalid Yjs update', () => {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MESSAGE_SYNC);
        encoding.writeVarUint(e, 2);
        encoding.writeVarUint8Array(e, new Uint8Array([255, 255, 255, 255, 255, 1, 2, 3]));
        return encoding.toUint8Array(e);
      }],
    ];
    for (const [name, make] of bad) {
      it(name, async () => {
        const [a, b, id] = await pair();
        createSticky(a.doc, { x: 1, y: 1 });
        await converge([a, b]);
        const before = JSON.stringify(b.snapshot());
        a.ws.send(make());
        await waitUntil(() => a.closeCode !== null, 10_000, 'close of sender');
        expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
        expect(b.closeCode).toBeNull();
        createSticky(b.doc, { x: 2, y: 2 });
        const c = await WsClient.connect(id);
        await c.waitForSync();
        await waitUntil(() => c.snapshot().length === 2);
        expect(JSON.stringify(b.snapshot().slice(0, 1))).toBe(JSON.stringify(JSON.parse(before)));
        b.close(); c.close();
      });
    }
  });

  it('TC-16 awareness frames reach everyone including the sender, verbatim', async () => {
    const [a, b] = await pair();
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3, 4]));
    const bytes = encoding.toUint8Array(enc);
    a.ws.send(bytes);
    const got = (c: WsClient) => c.log.filter((m) => m.type === MESSAGE_AWARENESS);
    await waitUntil(() => got(a).length === 1 && got(b).length === 1);
    expect(Array.from(got(a)[0].bytes)).toEqual(Array.from(bytes));
    expect(Array.from(got(b)[0].bytes)).toEqual(Array.from(bytes));
    a.close(); b.close();
  });

  it('TC-18 a fresh room is repopulated by the first reconnecting client', async () => {
    const [a, b] = await pair();
    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i, y: i });
    await converge([a, b]);
    createSticky(b.doc, { x: 50, y: 50 }); // B holds something A may lack
    await converge([a, b]);
    a.close(); b.close();
    await settle();
    const fresh = newBoardId(); // a new object id stands in for a restarted instance
    const a2 = await WsClient.connect(fresh, a.doc);
    await a2.waitForSync();
    const probe = await WsClient.connect(fresh);
    await probe.waitForSync();
    await converge([a2, probe]);
    expect(probe.snapshot()).toHaveLength(4);
    const b2 = await WsClient.connect(fresh, b.doc);
    await b2.waitForSync();
    await converge([a2, b2, probe]);
    a2.close(); b2.close(); probe.close();
  });

  it('TC-31 a dead socket does not break the room', async () => {
    const [a, b, id] = await pair();
    b.ws.close(1001);
    createSticky(a.doc, { x: 1, y: 1 });
    await settle(100);
    createSticky(a.doc, { x: 2, y: 2 });
    const c = await WsClient.connect(id);
    await c.waitForSync();
    await waitUntil(() => c.snapshot().length === 2);
    createSticky(a.doc, { x: 3, y: 3 });
    await waitUntil(() => c.snapshot().length === 3);
    a.close(); c.close();
  });
});
