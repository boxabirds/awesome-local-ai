import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { BoardRoom } from '../../src/worker/board-room';
import { newBoardId } from '../../src/shared/board-id';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, encodeAwareness, encodeQueryAwareness, encodeSync } from '../../src/shared/protocol';
import { TestClient, converged, quiet, waitFor } from './ws-client';
import { randomOp, seededRandom, type OpLog } from '../fixtures/random-ops';

const open: TestClient[] = [];

async function join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.connect(boardId, doc);
  open.push(c);
  return c;
}

afterEach(() => {
  open.splice(0).forEach((c) => c.close());
});

/** The room's own document, read inside the Durable Object. */
async function roomNotes(boardId: string) {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const update = await runInDurableObject(stub, (room: BoardRoom) => {
    const doc = (room as unknown as { doc: Y.Doc | null }).doc;
    return doc ? Y.encodeStateAsUpdate(doc) : null;
  });
  const copy = new Y.Doc();
  if (update) Y.applyUpdate(copy, update);
  return snapshot(copy);
}

function insertText(doc: Y.Doc, id: string, at: number, s: string) {
  const text = getStickyText(doc, id)!;
  doc.transact(() => text.insert(at, s), LOCAL_ORIGIN);
}

async function pairWithNote() {
  const boardId = newBoardId();
  const a = await join(boardId);
  const b = await join(boardId);
  const id = createSticky(a.doc, { x: 0, y: 0 });
  await converged([a, b]);
  return { boardId, a, b, id };
}

describe('sync.room: single writer', () => {
  it('TC-07 a created note reaches the other client as exactly one update', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const before = b.count('update');
    createSticky(a.doc, { x: 120, y: -40 }, 'blue');
    await converged([a, b]);
    expect(b.notes()).toEqual(a.notes());
    expect(b.notes()).toHaveLength(1);
    await quiet();
    expect(b.count('update') - before).toBe(1);
  });

  const kinds: Array<[string, (doc: Y.Doc, id: string) => void]> = [
    ['move', (doc, id) => moveObject(doc, id, 300, 400)],
    ['recolour', (doc, id) => setStickyColor(doc, id, 'pink')],
    ['text insert', (doc, id) => insertText(doc, id, 0, 'Pricing')],
    ['delete', (doc, id) => deleteObject(doc, id)],
  ];
  it.each(kinds)('TC-08 %s reaches the other client and is not echoed to the sender', async (_kind, op) => {
    const { a, b, id } = await pairWithNote();
    const aUpdates = a.count('update');
    const bUpdates = b.count('update');
    const before = JSON.stringify(b.notes());
    op(a.doc, id);
    await waitFor(() => JSON.stringify(b.notes()) !== before, 'change on B');
    expect(b.notes()).toEqual(a.notes());
    expect(b.count('update')).toBe(bUpdates + 1);
    await quiet();
    expect(a.count('update')).toBe(aUpdates);
  });
});

describe('sync.room: concurrent edits', () => {
  it("TC-09 concurrent typing in one note keeps everyone's characters", async () => {
    const { a, b, id } = await pairWithNote();
    insertText(a.doc, id, 0, 'green');
    await converged([a, b]);
    a.hold();
    b.hold();
    insertText(a.doc, id, 0, 'red ');
    insertText(b.doc, id, 'green'.length, ' blue');
    a.release();
    b.release();
    const notes = await converged([a, b]);
    expect(notes[0].text).toBe('red green blue');
  });

  it('TC-10 concurrent moves of one note settle to the same position everywhere', async () => {
    const { a, b, id } = await pairWithNote();
    a.hold();
    b.hold();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.release();
    b.release();
    const notes = await converged([a, b]);
    expect([100, 300]).toContain(notes[0].x);
  });

  it('TC-11 a delete wins over concurrent typing and the note does not come back', async () => {
    const { boardId, a, b, id } = await pairWithNote();
    a.hold();
    b.hold();
    deleteObject(a.doc, id);
    expect(() => insertText(b.doc, id, 0, 'lost words')).not.toThrow();
    a.release();
    b.release();
    const notes = await converged([a, b]);
    expect(notes).toEqual([]);
    const c = await join(boardId);
    expect(c.notes()).toEqual([]);
    expect(await roomNotes(boardId)).toEqual([]);
    for (const doc of [a.doc, b.doc, c.doc]) expect(JSON.stringify(doc.toJSON())).not.toContain('lost words');
  });

  it('TC-12 MAX_CONCURRENT_EDITORS clients making 200 seeded random ops each end identical', async () => {
    const seed = Number(process.env.VIDI6_SEED ?? Date.now() % 1_000_000);
    console.info(`TC-12 seed ${seed}`);
    const boardId = newBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await join(boardId));
    const log: OpLog = { created: [], deleted: [] };
    const rands = clients.map((_, i) => seededRandom(seed * 31 + i));
    for (let step = 0; step < 200; step++) {
      clients.forEach((c, i) => randomOp(c.doc, rands[i], log));
      if (step % 10 === 0) await new Promise((r) => setTimeout(r, 1));
    }
    const notes = await converged(clients);
    const expected = new Set(log.created.filter((id) => !log.deleted.includes(id)));
    expect(new Set(notes.map((n) => n.id)), `seed ${seed}`).toEqual(expected);
    expect(await roomNotes(boardId)).toEqual(notes);
  });
});

describe('sync.room: joining, awareness, errors, restart', () => {
  it('TC-14 a late joiner receives the current board', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    for (let i = 0; i < 10; i++) {
      const ida = createSticky(a.doc, { x: i * 220, y: 0 }, 'green');
      insertText(a.doc, ida, 0, `alex ${i}`);
      const idb = createSticky(b.doc, { x: i * 220, y: 300 }, 'pink');
      insertText(b.doc, idb, 0, `sam ${i}`);
    }
    await converged([a, b]);
    const c = await join(boardId);
    expect(c.notes()).toHaveLength(20);
    expect(c.notes()).toEqual(a.notes());
  });

  const malformed: Array<[string, (a: TestClient) => void]> = [
    ['a text frame', (a) => a.send('hello')],
    ['truncated bytes', (a) => a.send(new Uint8Array([0, 2, 40, 1]))],
    ['an unknown message type', (a) => a.send(new Uint8Array([9, 1, 2]))],
    [
      'an invalid Yjs update',
      (a) => a.send(encodeSync((e) => syncProtocol.writeUpdate(e, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f])))),
    ],
  ];
  it.each(malformed)('TC-15 %s closes only the sender with 1003 and leaves the room intact', async (_label, sendBad) => {
    const { boardId, a, b } = await pairWithNote();
    const before = await roomNotes(boardId);
    sendBad(a);
    expect(await a.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await roomNotes(boardId)).toEqual(before);
    expect(b.closeCode).toBeNull();

    const c = await join(boardId);
    createSticky(c.doc, { x: 500, y: 500 });
    await converged([b, c]);
    expect(b.notes()).toHaveLength(2);
    expect(b.closeCode).toBeNull();
  });

  it('TC-16 awareness is relayed verbatim to everyone including the sender', async () => {
    const { a, b } = await pairWithNote();
    const awareness = new awarenessProtocol.Awareness(a.doc);
    awareness.setLocalState({ probe: 'hello' });
    const frame = encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [a.doc.clientID]));
    awareness.destroy();
    a.send(frame);
    await waitFor(() => a.count('awareness') > 0 && b.count('awareness') > 0, 'awareness relay');
    const got = (c: TestClient) => [...c.received.filter((r) => r.kind === 'awareness')[0].bytes];
    expect(got(a)).toEqual([...frame]);
    expect(got(b)).toEqual([...frame]);

    // Query-awareness is ignored: no reply, no close.
    const before = a.received.length;
    a.send(encodeQueryAwareness());
    await quiet();
    expect(a.received.length).toBe(before);
    expect(a.closeCode).toBeNull();
  });

  it('TC-18 after a room restart the first reconnecting client repopulates it and others converge', async () => {
    const { a, b } = await pairWithNote();
    insertText(a.doc, a.notes()[0].id, 0, 'kept');
    await converged([a, b]);
    a.hold();
    createSticky(a.doc, { x: 900, y: 900 }, 'orange'); // only A has this when the room goes away
    a.close();
    b.close();

    // A fresh object instance (new object id) stands in for the restarted room.
    const fresh = newBoardId();
    const a2 = await join(fresh, a.doc);
    await quiet(); // A's SyncStep2 answer to the room's SyncStep1
    expect(snapshot(a.doc)).toHaveLength(2);
    expect(await roomNotes(fresh)).toEqual(snapshot(a.doc));

    const b2 = await join(fresh, b.doc);
    const notes = await converged([a2, b2]);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.text)).toContain('kept');
  });

  it('TC-31 a dead socket is dropped and the room keeps delivering', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    b.close();
    createSticky(a.doc, { x: 1, y: 1 }); // sent while the room may still hold B's socket
    createSticky(a.doc, { x: 2, y: 2 });
    const c = await join(boardId);
    expect(c.notes()).toHaveLength(2);
    createSticky(a.doc, { x: 3, y: 3 });
    await converged([a, c]);
    expect(c.notes()).toHaveLength(3);
    expect(a.closeCode).toBeNull();
  });
});
