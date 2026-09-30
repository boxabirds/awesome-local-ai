import { afterEach, describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  objectsMap,
  setStickyColor,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../../src/shared/protocol';
import { newOpLog, randomOp, seededRandom } from '../fixtures/random-ops';
import { TestClient, awarenessFrame, settle, syncFrame, waitForConvergence } from './ws-client';

const clients: TestClient[] = [];
async function join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const client = await TestClient.join(boardId, doc);
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const c of clients.splice(0)) {
    c.close();
  }
});

function typeText(doc: Y.Doc, id: string, index: number, text: string): void {
  const ytext = getStickyText(doc, id);
  if (!ytext) throw new Error('no text');
  doc.transact(() => ytext.insert(index, text), LOCAL_ORIGIN);
}

/** Two participants on a fresh board that already share one note. */
async function pairWithNote() {
  const boardId = newBoardId();
  const a = await join(boardId);
  const b = await join(boardId);
  const id = createSticky(a.doc, { x: 0, y: 0 });
  if (id === false) throw new Error('create failed');
  await waitForConvergence([a, b]);
  return { boardId, a, b, id };
}

describe('BoardRoom relay (sync.room)', () => {
  it('TC-07: a created note reaches the other participant as exactly one update', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    createSticky(a.doc, { x: 100, y: 200 }, 'green');
    await waitForConvergence([a, b]);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.snapshot()).toHaveLength(1);
    await settle();
    expect(b.updatesReceived()).toHaveLength(1);
  });

  describe('TC-08: each change kind reaches the other participant without echo', () => {
    const kinds: [string, (doc: Y.Doc, id: string) => void][] = [
      ['move', (doc, id) => moveObject(doc, id, 321, -45)],
      ['recolour', (doc, id) => setStickyColor(doc, id, 'violet')],
      ['text insert', (doc, id) => typeText(doc, id, 0, 'Pricing')],
      ['delete', (doc, id) => deleteObject(doc, id)],
    ];
    it.each(kinds)('%s', async (_kind, mutate) => {
      const { a, b, id } = await pairWithNote();
      const echoesBefore = a.updatesReceived().length;
      const before = JSON.stringify(b.snapshot());
      mutate(a.doc, id);
      await waitForConvergence([a, b]);
      expect(JSON.stringify(b.snapshot())).not.toBe(before);
      expect(b.snapshot()).toEqual(a.snapshot());
      await settle();
      expect(a.updatesReceived()).toHaveLength(echoesBefore);
    });
  });

  it("TC-09: simultaneous typing keeps every character ('red green blue')", async () => {
    const { a, b, id } = await pairWithNote();
    typeText(a.doc, id, 0, 'green');
    await waitForConvergence([a, b]);
    a.hold();
    b.hold();
    typeText(a.doc, id, 0, 'red ');
    typeText(b.doc, id, 'green'.length, ' blue');
    a.release();
    b.release();
    await waitForConvergence([a, b]);
    expect(getStickyText(a.doc, id)?.toString()).toBe('red green blue');
    expect(getStickyText(b.doc, id)?.toString()).toBe('red green blue');
  });

  it('TC-10: simultaneous moves of the same note settle to one position everywhere', async () => {
    const { a, b, id } = await pairWithNote();
    a.hold();
    b.hold();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.release();
    b.release();
    await waitForConvergence([a, b]);
    const x = a.snapshot()[0]?.x;
    expect([100, 300]).toContain(x);
    expect(b.snapshot()[0]?.x).toBe(x);
  });

  it('TC-11: a delete wins over simultaneous typing and the note never comes back', async () => {
    const { boardId, a, b, id } = await pairWithNote();
    a.hold();
    b.hold();
    deleteObject(a.doc, id);
    typeText(b.doc, id, 0, 'lost words');
    a.release();
    b.release();
    await waitForConvergence([a, b]);
    await settle();
    for (const c of [a, b]) {
      expect(c.snapshot()).toEqual([]);
      expect(objectsMap(c.doc).has(id)).toBe(false);
      expect(c.errors).toEqual([]);
      expect(c.closeEvent).toBeNull();
    }
    // A late joiner sees the same: the note and B's text are nowhere.
    const late = await join(boardId);
    expect(late.snapshot()).toEqual([]);
  });

  it(`TC-12: MAX_CONCURRENT_EDITORS (${MAX_CONCURRENT_EDITORS}) participants × 200 seeded random ops converge`, async () => {
    const seed = Date.now() >>> 0;
    console.info(`TC-12 random-ops seed: ${seed}`);
    const rand = seededRandom(seed);
    const boardId = newBoardId();
    const participants: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) participants.push(await join(boardId));
    const log = newOpLog();
    const remaining = participants.map(() => 200);
    while (remaining.some((n) => n > 0)) {
      const i = Math.floor(rand() * participants.length);
      if (remaining[i] === 0) continue;
      remaining[i]!--;
      randomOp(participants[i]!.doc, rand, log);
      // Let deliveries interleave with further edits.
      if (rand() < 0.2) await settle(1);
    }
    await waitForConvergence(participants, 10_000);
    const ids = participants[0]!.snapshot().map((n) => n.id).sort();
    const expected = [...log.created].filter((id) => !log.deleted.has(id)).sort();
    expect(ids, `seed ${seed}`).toEqual(expected);
    for (const p of participants) expect(p.errors).toEqual([]);
  });

  it('TC-14: a late joiner receives the current board (20 notes)', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    for (let i = 0; i < 10; i++) {
      const idA = createSticky(a.doc, { x: i * 10, y: 0 }, 'orange');
      const idB = createSticky(b.doc, { x: 0, y: i * 10 }, 'blue');
      if (idA !== false) typeText(a.doc, idA, 0, `A${i}`);
      if (idB !== false) typeText(b.doc, idB, 0, `B${i}`);
    }
    await waitForConvergence([a, b]);
    const c = await join(boardId);
    expect(c.snapshot()).toHaveLength(20);
    expect(c.snapshot()).toEqual(a.snapshot());
  });

  describe('TC-15: malformed traffic closes only the sender', () => {
    const invalidUpdate = syncFrame((e) => syncProtocol.writeUpdate(e, new Uint8Array([200, 1, 2, 3, 4, 5, 6, 7])));
    const runs: [string, Uint8Array | string][] = [
      ['text frame', 'hello'],
      ['truncated bytes', new Uint8Array([MESSAGE_SYNC, syncProtocol.messageYjsUpdate, 40, 1, 2])],
      ['unknown message type', new Uint8Array([9, 1, 2])],
      ['invalid Yjs update', invalidUpdate],
    ];
    it.each(runs)('%s', async (_label, message) => {
      const { boardId, a, b, id } = await pairWithNote();
      const before = JSON.stringify(b.snapshot());
      a.send(message);
      await expect.poll(() => a.closeEvent?.code).toBe(CLOSE_UNSUPPORTED_DATA);
      // The room document is unchanged: a late joiner sees exactly what B has.
      const late = await join(boardId);
      expect(JSON.stringify(late.snapshot())).toBe(before);
      // B stays connected and keeps receiving updates.
      expect(b.closeEvent).toBeNull();
      moveObject(late.doc, id, 77, 88);
      await waitForConvergence([late, b]);
      expect(b.snapshot()[0]).toMatchObject({ x: 77, y: 88 });
    });
  });

  it('TC-16: awareness bytes are relayed verbatim to everyone, sender included', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const message = awarenessFrame(new Uint8Array([1, 42, 7, 3, 123, 125]));
    a.send(message);
    const awarenessOf = (c: TestClient) => c.received.filter((m) => m.type === MESSAGE_AWARENESS);
    await expect.poll(() => awarenessOf(a).length).toBe(1);
    await expect.poll(() => awarenessOf(b).length).toBe(1);
    expect(Array.from(awarenessOf(a)[0]!.bytes)).toEqual(Array.from(message));
    expect(Array.from(awarenessOf(b)[0]!.bytes)).toEqual(Array.from(message));
  });

  it('TC-18: after a room restart the first reconnecting participant repopulates it', async () => {
    const { a, b } = await pairWithNote();
    createSticky(a.doc, { x: 500, y: 500 }, 'pink');
    await waitForConvergence([a, b]);
    // Restart: every socket closes; the fresh instance starts with an empty doc.
    a.close();
    b.close();
    // B keeps editing while the room is down.
    createSticky(b.doc, { x: -500, y: -500 }, 'green');
    const fresh = newBoardId();
    const a2 = await join(fresh, a.doc);
    // The fresh room's doc now equals A's doc: a probe joining it sees A's board.
    const probe = await join(fresh);
    expect(probe.snapshot()).toEqual(a2.snapshot());
    expect(probe.snapshot()).toHaveLength(2);
    const b2 = await join(fresh, b.doc);
    await waitForConvergence([a2, b2, probe]);
    expect(a2.snapshot()).toHaveLength(3);
  });

  it('TC-31: a dead socket is dropped and the room keeps delivering', async () => {
    const { boardId, a, b } = await pairWithNote();
    b.ws.close(1001, 'gone');
    createSticky(a.doc, { x: 1, y: 1 });
    createSticky(a.doc, { x: 2, y: 2 });
    await settle();
    const c = await join(boardId);
    expect(c.snapshot()).toEqual(a.snapshot());
    createSticky(a.doc, { x: 3, y: 3 });
    await waitForConvergence([a, c]);
    expect(c.snapshot()).toHaveLength(4);
  });
});
