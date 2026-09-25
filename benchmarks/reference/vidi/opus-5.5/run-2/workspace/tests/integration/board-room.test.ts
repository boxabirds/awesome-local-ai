import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { randomOp, seededRandom, type OpLog } from '../fixtures/random-ops';
import { TestClient, createdBoardId, sameState, sleep, waitConverged, waitUntil } from './helpers/ws-client';

const QUIET_MS = 100;
const OPS_PER_CLIENT = 200;
const LATE_JOIN_NOTES = 20;
const INVALID_YJS_UPDATE = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
const UNKNOWN_TYPE = 9;

let open: TestClient[] = [];

async function join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.connect(boardId, doc);
  open.push(c);
  await c.waitForSync();
  return c;
}

async function pair(): Promise<[TestClient, TestClient, string]> {
  const boardId = await createdBoardId();
  const a = await join(boardId);
  const b = await join(boardId);
  await waitConverged([a, b]);
  return [a, b, boardId];
}

function type(doc: Y.Doc, id: string, at: number, text: string): void {
  doc.transact(() => getStickyText(doc, id)?.insert(at, text), LOCAL_ORIGIN);
}

/** Proves A got no echo: B makes one more change, and A receives exactly that one. */
async function expectNoEcho(a: TestClient, b: TestClient, before: number): Promise<void> {
  const probe = createSticky(b.doc, { x: -500, y: -500 });
  await waitUntil(() => a.snapshot().some((n) => n.id === probe), 'probe note');
  expect(a.updatesReceived() - before).toBe(1);
}

afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

describe('BoardRoom (sync.room)', () => {
  it('TC-07 a created note reaches the other client as exactly one update', async () => {
    const [a, b] = await pair();
    const before = b.updatesReceived();
    createSticky(a.doc, { x: 100, y: 200 });
    await waitConverged([a, b]);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.snapshot()).toHaveLength(1);
    await sleep(QUIET_MS);
    expect(b.updatesReceived() - before).toBe(1);
  });

  describe('TC-08 each kind of change reaches the other client without echo', () => {
    async function setup(): Promise<[TestClient, TestClient, string]> {
      const [a, b] = await pair();
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await waitConverged([a, b]);
      return [a, b, id];
    }

    it('move', async () => {
      const [a, b, id] = await setup();
      const before = a.updatesReceived();
      moveObject(a.doc, id, 640, -320);
      await waitConverged([a, b]);
      expect(b.snapshot()[0]).toMatchObject({ x: 640, y: -320 });
      await expectNoEcho(a, b, before);
    });

    it('recolour', async () => {
      const [a, b, id] = await setup();
      const before = a.updatesReceived();
      setStickyColor(a.doc, id, 'pink');
      await waitConverged([a, b]);
      expect(b.snapshot()[0]?.color).toBe('pink');
      await expectNoEcho(a, b, before);
    });

    it('text insert', async () => {
      const [a, b, id] = await setup();
      const before = a.updatesReceived();
      type(a.doc, id, 0, 'Pricing');
      await waitConverged([a, b]);
      expect(b.snapshot()[0]?.text).toBe('Pricing');
      await expectNoEcho(a, b, before);
    });

    it('delete', async () => {
      const [a, b, id] = await setup();
      const before = a.updatesReceived();
      deleteObject(a.doc, id);
      await waitConverged([a, b]);
      expect(b.snapshot()).toEqual([]);
      await expectNoEcho(a, b, before);
    });
  });

  it('TC-09 concurrent typing in one note keeps both insertions', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    type(a.doc, id, 0, 'green');
    await waitConverged([a, b]);
    a.hold();
    b.hold();
    type(a.doc, id, 0, 'red ');
    type(b.doc, id, 'green'.length, ' blue');
    a.release();
    b.release();
    await waitConverged([a, b]);
    expect(a.snapshot()[0]?.text).toBe('red green blue');
    expect(b.snapshot()[0]?.text).toBe('red green blue');
  });

  it('TC-10 concurrent moves of one note settle on the same x everywhere', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitConverged([a, b]);
    a.hold();
    b.hold();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.release();
    b.release();
    await waitConverged([a, b]);
    const x = a.snapshot()[0]?.x;
    expect([100, 300]).toContain(x);
    expect(b.snapshot()[0]?.x).toBe(x);
  });

  it('TC-11 a deleted note stays deleted despite concurrent typing in it', async () => {
    const [a, b, boardId] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    type(a.doc, id, 0, 'draft');
    await waitConverged([a, b]);
    a.hold();
    b.hold();
    deleteObject(a.doc, id);
    expect(() => type(b.doc, id, 5, ' resurrect')).not.toThrow();
    a.release();
    b.release();
    await waitConverged([a, b]);
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
    const late = await join(boardId);
    expect(late.snapshot()).toEqual([]);
    for (const doc of [a.doc, b.doc, late.doc]) expect(JSON.stringify(doc.getMap('objects').toJSON())).not.toContain('resurrect');
  });

  it(`TC-12 ${MAX_CONCURRENT_EDITORS} clients x ${OPS_PER_CLIENT} seeded random ops converge`, async () => {
    const seed = Date.now() % 1_000_000;
    console.log(`TC-12 seed ${seed}`);
    const boardId = await createdBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await join(boardId));
    const log: OpLog = { created: new Set(), deleted: new Set() };
    const rands = clients.map((_, i) => seededRandom(seed + i));
    for (let step = 0; step < OPS_PER_CLIENT; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i]!, log));
      if (step % 10 === 0) await sleep(1); // let some traffic interleave with further edits
    }
    await waitConverged(clients, 10_000);
    const first = clients[0]!.snapshot();
    for (const c of clients) expect(c.snapshot()).toEqual(first);
    const present = new Set(first.map((n) => n.id));
    for (const id of log.created) expect(present.has(id) || log.deleted.has(id)).toBe(true);
  });

  it(`TC-14 a late joiner receives all ${LATE_JOIN_NOTES} notes`, async () => {
    const [a, b, boardId] = await pair();
    for (let i = 0; i < LATE_JOIN_NOTES; i++) {
      const author = i % 2 === 0 ? a : b;
      const id = createSticky(author.doc, { x: i * 220, y: 0 }, i % 3 === 0 ? 'blue' : 'yellow');
      type(author.doc, id, 0, `Idea ${i + 1}`);
    }
    await waitConverged([a, b]);
    const c = await join(boardId);
    expect(c.snapshot()).toEqual(a.snapshot());
    expect(c.snapshot()).toHaveLength(LATE_JOIN_NOTES);
  });

  describe('TC-15 malformed traffic closes only the sender and leaves the doc unchanged', () => {
    const cases: [string, (a: TestClient) => void][] = [
      ['text frame', (a) => a.sendRaw('hello')],
      ['truncated bytes', (a) => a.sendRaw(new Uint8Array([MESSAGE_SYNC, 2, 40, 1]))],
      ['unknown type', (a) => a.sendRaw(new Uint8Array([UNKNOWN_TYPE, 0]))],
      [
        'invalid Yjs update',
        (a) => {
          const e = encoding.createEncoder();
          encoding.writeVarUint(e, MESSAGE_SYNC);
          syncProtocol.writeUpdate(e, INVALID_YJS_UPDATE);
          a.sendRaw(encoding.toUint8Array(e));
        },
      ],
    ];
    for (const [name, send] of cases) {
      it(name, async () => {
        const [a, b, boardId] = await pair();
        createSticky(b.doc, { x: 0, y: 0 });
        await waitConverged([a, b]);
        send(a);
        await waitUntil(() => a.closeCode !== null, 'sender to be closed');
        expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
        expect(b.closeCode).toBeNull();
        // The room doc is unchanged: a fresh joiner has exactly B's state.
        const c = await join(boardId);
        expect(sameState(c.doc, b.doc)).toBe(true);
        // B is still connected and still receives updates.
        createSticky(c.doc, { x: 300, y: 0 });
        await waitConverged([b, c]);
        expect(b.snapshot()).toHaveLength(2);
      });
    }
  });

  it('TC-16 awareness bytes are relayed verbatim to everyone including the sender', async () => {
    const [a, b] = await pair();
    const awareness = new awarenessProtocol.Awareness(a.doc);
    const frame = a.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [a.doc.clientID]));
    awareness.destroy();
    const isAwareness = (c: TestClient) => c.received.filter((m) => m.type === MESSAGE_AWARENESS);
    await waitUntil(() => isAwareness(a).length === 1 && isAwareness(b).length === 1, 'awareness relay');
    expect([...isAwareness(a)[0]!.bytes]).toEqual([...frame]);
    expect([...isAwareness(b)[0]!.bytes]).toEqual([...frame]);
  });

  it('TC-18 after a room restart the first reconnecting client repopulates it and others converge', async () => {
    const [a, b] = await pair();
    createSticky(a.doc, { x: 0, y: 0 });
    await waitConverged([a, b]);
    a.close();
    b.close();
    // B has a change the room never saw (made while the room was down).
    createSticky(b.doc, { x: 400, y: 0 }, 'green');
    const fresh = await createdBoardId(); // a fresh object instance stands in for the restarted room
    const a2 = await join(fresh, a.doc);
    const probe = await join(fresh);
    expect(sameState(probe.doc, a.doc)).toBe(true);
    const b2 = await join(fresh, b.doc);
    await waitConverged([a2, b2, probe]);
    expect(a2.snapshot()).toHaveLength(2);
  });

  it('TC-31 a dead socket does not break delivery to the others', async () => {
    const [a, b, boardId] = await pair();
    b.ws.close(1001, 'gone');
    createSticky(a.doc, { x: 0, y: 0 });
    createSticky(a.doc, { x: 300, y: 0 });
    const c = await join(boardId);
    expect(c.snapshot()).toHaveLength(2);
    createSticky(a.doc, { x: 600, y: 0 });
    await waitConverged([a, c]);
    expect(c.snapshot()).toHaveLength(3);
  });
});
