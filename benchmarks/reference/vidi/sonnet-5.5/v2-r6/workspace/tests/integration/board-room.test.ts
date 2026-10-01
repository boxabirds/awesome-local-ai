import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky, deleteObject, getStickyText, moveObject, setStickyColor, snapshot,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { randomOp, rng } from './random-ops';
import { connect, converged, sleep, until, WsClient } from './ws-client';

const noteOf = (c: WsClient) => c.snapshot()[0];

async function pair() {
  const board = newBoardId();
  const a = await connect(board);
  const b = await connect(board);
  return { board, a, b };
}

describe('BoardRoom sync', () => {
  it('TC-07: a created note reaches B as exactly one update', async () => {
    const { a, b } = await pair();
    createSticky(a.doc, { x: 50, y: 60 });
    await until(() => b.snapshot().length === 1, 5000, 'note on B');
    await sleep(100);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.updateMessages).toBe(1);
  });

  describe('TC-08: each operation kind propagates without echo', () => {
    const cases: [string, (doc: Y.Doc, id: string) => void, (c: WsClient) => boolean][] = [
      ['move', (d, id) => { moveObject(d, id, 300, 400); }, (c) => noteOf(c)?.x === 300 && noteOf(c)?.y === 400],
      ['recolour', (d, id) => { setStickyColor(d, id, 'pink'); }, (c) => noteOf(c)?.color === 'pink'],
      ['text insert', (d, id) => { getStickyText(d, id)!.insert(0, 'hello'); }, (c) => noteOf(c)?.text === 'hello'],
      ['delete', (d, id) => { deleteObject(d, id); }, (c) => c.snapshot().length === 0],
    ];
    for (const [name, mutate, check] of cases) {
      it(name, async () => {
        const { a, b } = await pair();
        const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
        await until(() => b.snapshot().length === 1, 5000, 'create');
        const aUpdatesBefore = a.updateMessages;
        mutate(a.doc, id);
        await until(() => check(b), 5000, `${name} on B`);
        expect(b.snapshot()).toEqual(a.snapshot());
        await sleep(100);
        expect(a.updateMessages).toBe(aUpdatesBefore); // no echo of its own update
      });
    }
  });

  it('TC-09: concurrent typing keeps every character', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    getStickyText(a.doc, id)!.insert(0, 'green');
    await until(() => noteOf(b)?.text === 'green', 5000, 'green on B');
    a.pause();
    b.pause();
    getStickyText(a.doc, id)!.insert(0, 'red ');
    const bt = getStickyText(b.doc, id)!;
    bt.insert(bt.length, ' blue');
    a.resume();
    b.resume();
    await until(() => noteOf(a)?.text === 'red green blue' && noteOf(b)?.text === 'red green blue', 5000, 'merge');
  });

  it('TC-10: concurrent moves settle to one value', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await until(() => b.snapshot().length === 1, 5000, 'create');
    a.pause();
    b.pause();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.resume();
    b.resume();
    await converged([a, b]);
    expect([100, 300]).toContain(noteOf(a).x);
    expect(noteOf(a).x).toBe(noteOf(b).x);
  });

  it('TC-11: delete wins over concurrent typing', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await until(() => b.snapshot().length === 1, 5000, 'create');
    a.pause();
    b.pause();
    deleteObject(a.doc, id);
    getStickyText(b.doc, id)!.insert(0, 'lost words');
    moveObject(b.doc, id, 5, 5);
    a.resume();
    b.resume();
    await converged([a, b]);
    expect(a.snapshot()).toHaveLength(0);
    expect(b.snapshot()).toHaveLength(0);
    expect(JSON.stringify(a.doc.getMap('objects').toJSON())).not.toContain('lost words');
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients × 200 seeded ops converge', async () => {
    const board = newBoardId();
    const seed = 20240601;
    console.log(`TC-12 seed ${seed}`);
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await connect(board));
    const created = new Set<string>();
    const deleted = new Set<string>();
    const rands = clients.map((_, i) => rng(seed + i));
    for (let step = 0; step < 200; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i], created, deleted));
      if (step % 10 === 0) await sleep(1);
    }
    await converged(clients);
    const ids = new Set(clients[0].snapshot().map((n) => n.id));
    for (const id of created) if (!deleted.has(id)) expect(ids.has(id)).toBe(true);
    clients.forEach((c) => c.close());
  });

  it('TC-14: a late joiner sees all 20 notes', async () => {
    const { board, a, b } = await pair();
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 10, y: 0 });
      createSticky(b.doc, { x: i * 10, y: 100 });
    }
    await converged([a, b]);
    expect(a.snapshot()).toHaveLength(20);
    const c = await connect(board);
    await converged([a, c]);
    expect(c.snapshot()).toEqual(a.snapshot());
  });

  describe('TC-15: malformed traffic closes only the sender', () => {
    const syncFrame = (...bytes: number[]) => new Uint8Array([MESSAGE_SYNC, ...bytes]);
    const runs: [string, () => Uint8Array | string][] = [
      ['text frame', () => 'hello'],
      ['truncated bytes', () => new Uint8Array([0x80])],
      ['unknown type', () => new Uint8Array([9, 1, 2, 3])],
      ['invalid Yjs update', () => syncFrame(2, 5, 255, 255, 255, 255, 255)],
    ];
    for (const [name, frame] of runs) {
      it(name, async () => {
        const { board, a, b } = await pair();
        const id = createSticky(b.doc, { x: 0, y: 0 }) as string;
        await converged([a, b]);
        a.sendRaw(frame());
        await until(() => a.closeCode === CLOSE_UNSUPPORTED_DATA, 5000, 'close 1003');
        expect(b.closeCode).toBeNull();
        moveObject(b.doc, id, 77, 88);
        const c = await connect(board);
        await until(() => noteOf(c)?.x === 77, 5000, 'update after malformed');
        expect(c.snapshot()).toEqual(b.snapshot());
      });
    }
  });

  it('TC-16: awareness bytes are relayed to everyone including the sender', async () => {
    const { a, b } = await pair();
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3, 4]));
    const bytes = encoding.toUint8Array(enc);
    a.sendRaw(bytes);
    await until(() => a.awarenessMessages.length === 1 && b.awarenessMessages.length === 1, 5000, 'awareness');
    expect([...a.awarenessMessages[0]]).toEqual([...bytes]);
    expect([...b.awarenessMessages[0]]).toEqual([...bytes]);
  });

  it('TC-18: a fresh room is repopulated by the first reconnecting client', async () => {
    const { a, b } = await pair();
    createSticky(a.doc, { x: 1, y: 1 });
    createSticky(b.doc, { x: 2, y: 2 });
    await converged([a, b]);
    const docA = a.doc;
    const docB = b.doc;
    a.close();
    b.close();
    const fresh = newBoardId();
    const a2 = await connect(fresh, docA);
    const probe = await connect(fresh);
    await converged([a2, probe]);
    expect(probe.snapshot()).toEqual(snapshot(docA));
    probe.close();
    docB.getMap('objects'); // B reconnects second and converges
    const b2 = await connect(fresh, docB);
    await converged([a2, b2]);
    expect(b2.snapshot()).toHaveLength(2);
  });

  it('TC-31: an abruptly closed socket does not break the room', async () => {
    const { board, a, b } = await pair();
    b.ws.close(1001);
    createSticky(a.doc, { x: 0, y: 0 });
    await sleep(100);
    const c = await connect(board);
    await until(() => c.snapshot().length === 1, 5000, 'late joiner after dead socket');
    createSticky(a.doc, { x: 5, y: 5 });
    await until(() => c.snapshot().length === 2, 5000, 'update after dead socket');
  });
});
