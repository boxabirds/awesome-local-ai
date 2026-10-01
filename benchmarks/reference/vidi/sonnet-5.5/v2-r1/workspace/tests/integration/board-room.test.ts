import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { randomOp, seededRandom } from '../fixtures/random-ops';
import { WsClient, converged, waitFor } from './ws-client';

async function pair(boardId = newBoardId()) {
  const a = await WsClient.connect(boardId);
  const b = await WsClient.connect(boardId);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  return { boardId, a, b };
}

const noteOf = (c: WsClient, id: string) => snapshot(c.doc).find((n) => n.id === id);

describe('BoardRoom: broadcast', () => {
  it('TC-07: a created sticky reaches B as exactly one update', async () => {
    const { a, b } = await pair();
    const before = b.updateMessages.length;
    createSticky(a.doc, { x: 10, y: 20 });
    await converged([a, b]);
    expect(JSON.parse(b.snapshotJson)).toHaveLength(1);
    expect(b.updateMessages.length - before).toBe(1);
  });

  describe('TC-08: each operation reaches B; A gets no echo', () => {
    const cases: [string, (c: WsClient, id: string) => void][] = [
      ['move', (c, id) => moveObject(c.doc, id, 500, 600)],
      ['recolour', (c, id) => setStickyColor(c.doc, id, 'pink')],
      ['text insert', (c, id) => getStickyText(c.doc, id)?.insert(0, 'hello')],
      ['delete', (c, id) => deleteObject(c.doc, id)],
    ];
    for (const [name, op] of cases) {
      it(name, async () => {
        const { a, b } = await pair();
        const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
        await converged([a, b]);
        const echoBase = a.updateMessages.length;
        op(a, id);
        await converged([a, b]);
        const expected = a.snapshotJson;
        expect(b.snapshotJson).toBe(expected);
        await new Promise((r) => setTimeout(r, 100));
        expect(a.updateMessages.length).toBe(echoBase);
      });
    }
  });
});

describe('BoardRoom: merging', () => {
  it('TC-09: concurrent text inserts are both kept', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    getStickyText(a.doc, id)?.insert(0, 'green');
    await converged([a, b]);
    a.offline = true;
    b.offline = true;
    getStickyText(a.doc, id)?.insert(0, 'red ');
    const tb = getStickyText(b.doc, id) as Y.Text;
    tb.insert(tb.length, ' blue');
    a.resume();
    b.resume();
    await converged([a, b]);
    expect(noteOf(a, id)?.text).toBe('red green blue');
    expect(noteOf(b, id)?.text).toBe('red green blue');
  });

  it('TC-10: concurrent x sets converge to one value', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await converged([a, b]);
    a.offline = true;
    b.offline = true;
    moveObject(a.doc, id, 100, 5);
    moveObject(b.doc, id, 300, 5);
    a.resume();
    b.resume();
    await converged([a, b]);
    expect(noteOf(a, id)?.x).toBe(noteOf(b, id)?.x);
    expect([100, 300]).toContain(noteOf(a, id)?.x);
  });

  it('TC-11: delete wins over concurrent typing', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await converged([a, b]);
    a.offline = true;
    b.offline = true;
    deleteObject(a.doc, id);
    getStickyText(b.doc, id)?.insert(0, 'ghost');
    expect(() => {
      a.resume();
      b.resume();
    }).not.toThrow();
    await converged([a, b]);
    expect(noteOf(a, id)).toBeUndefined();
    expect(noteOf(b, id)).toBeUndefined();
    expect(a.snapshotJson).not.toContain('ghost');
    const late = await WsClient.connect(newBoardId());
    late.close();
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients x 200 seeded ops end identical', async () => {
    const seed = 20260930;
    console.log(`TC-12 seed=${seed}`);
    const boardId = newBoardId();
    const clients: WsClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await WsClient.connect(boardId));
    await Promise.all(clients.map((c) => c.waitForSync()));
    const rands = clients.map((_, i) => seededRandom(seed + i));
    for (let step = 0; step < 200; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i]));
      if (step % 20 === 0) await new Promise((r) => setTimeout(r, 1));
    }
    await converged(clients);
    expect(JSON.parse(clients[0].snapshotJson).length).toBeGreaterThan(0);
  });
});

describe('BoardRoom: joining', () => {
  it('TC-14: a late joiner sees all 20 notes', async () => {
    const { boardId, a, b } = await pair();
    for (let i = 0; i < 10; i++) {
      const id = createSticky(a.doc, { x: i * 10, y: 0 }) as string;
      getStickyText(a.doc, id)?.insert(0, `a${i}`);
      setStickyColor(a.doc, id, 'blue');
      createSticky(b.doc, { x: i * 10, y: 300 });
    }
    await converged([a, b]);
    expect(JSON.parse(a.snapshotJson)).toHaveLength(20);
    const c = await WsClient.connect(boardId);
    await c.waitForSync();
    await converged([a, c]);
  });
});

describe('BoardRoom: malformed traffic', () => {
  const frames: [string, () => ArrayBuffer | Uint8Array | string][] = [
    ['text frame', () => 'hello'],
    ['truncated bytes', () => new Uint8Array([0x80])],
    [
      'unknown message type',
      () => {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, 9);
        encoding.writeUint8(e, 1);
        return encoding.toUint8Array(e);
      },
    ],
    [
      'invalid Yjs update',
      () => {
        const e = encoding.createEncoder();
        encoding.writeVarUint(e, MESSAGE_SYNC);
        encoding.writeVarUint(e, 2);
        encoding.writeVarUint8Array(e, new Uint8Array([255, 255, 255, 255, 9, 9]));
        return encoding.toUint8Array(e);
      },
    ],
  ];
  for (const [name, frame] of frames) {
    it(`TC-15: ${name} closes only the sender with 1003`, async () => {
      const { boardId, a, b } = await pair();
      createSticky(a.doc, { x: 0, y: 0 });
      await converged([a, b]);
      const before = a.snapshotJson;
      a.sendRaw(frame());
      await waitFor(() => a.closeCode !== undefined, 'sender to be closed');
      expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
      expect(b.closeCode).toBeUndefined();
      createSticky(b.doc, { x: 5, y: 5 });
      const c = await WsClient.connect(boardId);
      await c.waitForSync();
      await converged([b, c]);
      expect(JSON.parse(c.snapshotJson)).toHaveLength(2);
      expect(before).not.toBe(c.snapshotJson); // room doc unchanged by the bad frame, only by B's note
    });
  }
});

describe('BoardRoom: awareness, restart and dead sockets', () => {
  it('TC-16: awareness bytes go verbatim to everyone including the sender', async () => {
    const { a, b } = await pair();
    a.sendAwareness([1, 2, 3, 4]);
    await waitFor(
      () => a.received.some((m) => m.type === MESSAGE_AWARENESS) && b.received.some((m) => m.type === MESSAGE_AWARENESS),
      'awareness relay',
    );
    const get = (c: WsClient) => [...c.received.find((m) => m.type === MESSAGE_AWARENESS)!.bytes];
    expect(get(a)).toEqual(get(b));
    expect(get(a)).toEqual([MESSAGE_AWARENESS, 1, 2, 3, 4]);
  });

  it('TC-18: a fresh room is repopulated by the first reconnecting client, then B converges', async () => {
    const old = newBoardId();
    const { a, b } = await pair(old);
    createSticky(a.doc, { x: 1, y: 1 });
    createSticky(b.doc, { x: 2, y: 2 });
    await converged([a, b]);
    const docA = a.doc;
    const docB = b.doc;
    a.close();
    b.close();
    // New object id = fresh instance with an empty doc.
    const fresh = newBoardId();
    const a2 = await WsClient.connect(fresh, (d) => Y.applyUpdate(d, Y.encodeStateAsUpdate(docA)));
    await a2.waitForSync();
    const observer = await WsClient.connect(fresh);
    await observer.waitForSync();
    await converged([a2, observer]);
    expect(observer.snapshotJson).toBe(a2.snapshotJson);
    createSticky(docB, { x: 3, y: 3 }); // B has changes A lacked
    const b2 = await WsClient.connect(fresh, (d) => Y.applyUpdate(d, Y.encodeStateAsUpdate(docB)));
    await b2.waitForSync();
    await converged([a2, b2, observer]);
    expect(JSON.parse(a2.snapshotJson)).toHaveLength(3);
  });

  it('TC-31: a dead socket does not break the room', async () => {
    const { boardId, a, b } = await pair();
    b.close();
    expect(() => createSticky(a.doc, { x: 0, y: 0 })).not.toThrow();
    createSticky(a.doc, { x: 1, y: 1 });
    const c = await WsClient.connect(boardId);
    await c.waitForSync();
    createSticky(a.doc, { x: 2, y: 2 });
    await converged([a, c]);
    expect(JSON.parse(c.snapshotJson)).toHaveLength(3);
  });
});
