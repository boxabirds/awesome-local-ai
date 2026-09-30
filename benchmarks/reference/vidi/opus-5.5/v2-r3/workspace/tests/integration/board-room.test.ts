import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  encodeAwarenessFrame,
} from '../../src/shared/protocol';
import { applyRandomOp, seededRandom, type OpLog } from '../fixtures/random-ops';
import { TestClient, equalBytes, waitFor, waitForConvergence } from './ws-client';

const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

async function connect(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const c = await TestClient.connect(boardId, doc);
  clients.push(c);
  return c;
}

async function pair(): Promise<{ boardId: string; a: TestClient; b: TestClient }> {
  const boardId = newBoardId();
  return { boardId, a: await connect(boardId), b: await connect(boardId) };
}

/** A and B share one note (created by A with `text`), fully synced. */
async function pairWithNote(text = ''): Promise<{ boardId: string; a: TestClient; b: TestClient; id: string }> {
  const p = await pair();
  const id = createSticky(p.a.doc, { x: 0, y: 0 });
  if (text) getStickyText(p.a.doc, id)!.insert(0, text);
  await waitForConvergence([p.a, p.b]);
  return { ...p, id };
}

describe('BoardRoom single writer (live.propagate)', () => {
  it('TC-07: a created note reaches B as exactly one update', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 120, y: -40 }, 'blue');
    await waitForConvergence([a, b]);
    expect(b.snapshot().map((n) => n.id)).toEqual([id]);
    expect(b.snapshot()).toEqual(a.snapshot());
    await b.barrier();
    expect(b.updateCount()).toBe(1);
  });

  const kinds: [string, (doc: Y.Doc, id: string) => void][] = [
    ['move', (doc, id) => moveObject(doc, id, 480, 260)],
    ['recolour', (doc, id) => setStickyColor(doc, id, 'pink')],
    ['text insert', (doc, id) => getStickyText(doc, id)!.insert(0, 'Pricing')],
    ['delete', (doc, id) => deleteObject(doc, id)],
  ];
  for (const [kind, mutate] of kinds) {
    it(`TC-08: ${kind} reaches B; A gets no echo`, async () => {
      const { a, b, id } = await pairWithNote();
      const before = b.updateCount();
      const aBefore = a.snapshot();
      mutate(a.doc, id);
      expect(a.snapshot()).not.toEqual(aBefore);
      await waitForConvergence([a, b]);
      expect(b.snapshot()).toEqual(a.snapshot());
      expect(b.updateCount()).toBe(before + 1);
      await a.barrier();
      expect(a.updateCount()).toBe(0);
    });
  }
});

describe('BoardRoom concurrent edits', () => {
  it("TC-09: 'red ' at the start and ' blue' at the end of 'green' → 'red green blue' everywhere", async () => {
    const { a, b, id } = await pairWithNote('green');
    a.pause();
    b.pause();
    getStickyText(a.doc, id)!.insert(0, 'red ');
    const bText = getStickyText(b.doc, id)!;
    bText.insert(bText.length, ' blue');
    a.resume();
    b.resume();
    await waitForConvergence([a, b]);
    expect(getStickyText(a.doc, id)!.toString()).toBe('red green blue');
    expect(getStickyText(b.doc, id)!.toString()).toBe('red green blue');
  });

  it('TC-10: concurrent x=100 and x=300 settle to one identical value', async () => {
    const { a, b, id } = await pairWithNote();
    a.pause();
    b.pause();
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.resume();
    b.resume();
    await waitForConvergence([a, b]);
    const xa = a.snapshot()[0].x;
    expect([100, 300]).toContain(xa);
    expect(b.snapshot()[0].x).toBe(xa);
  });

  it('TC-11: delete wins over concurrent typing; the note is not resurrected', async () => {
    const { boardId, a, b, id } = await pairWithNote('draft');
    a.pause();
    b.pause();
    expect(() => {
      deleteObject(a.doc, id);
      getStickyText(b.doc, id)!.insert(5, ' resurrect-me');
    }).not.toThrow();
    a.resume();
    b.resume();
    await waitForConvergence([a, b]);
    await a.barrier();
    await b.barrier();
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
    for (const c of [a, b]) {
      expect(JSON.stringify(c.doc.toJSON())).not.toContain('resurrect-me');
      expect(c.closeCode).toBeNull();
    }
    // A late joiner does not see it either.
    const c = await connect(boardId);
    expect(c.snapshot()).toEqual([]);
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients × 200 seeded random ops converge', async () => {
    const seed = (Date.now() ^ 0x5eed) >>> 0;
    console.log(`TC-12 seed ${seed}`);
    const boardId = newBoardId();
    const all: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) all.push(await connect(boardId));
    const rands = all.map((_, i) => seededRandom(seed + i));
    const logs: OpLog[] = all.map(() => ({ created: [], deleted: [] }));
    const OPS = 200;
    for (let op = 0; op < OPS; op++) {
      all.forEach((c, i) => applyRandomOp(c.doc, rands[i], logs[i]));
      // Let traffic interleave with further edits.
      if (op % 10 === 0) await new Promise((r) => setTimeout(r, 1));
    }
    await waitForConvergence(all, 20_000);
    const ids = new Set(all[0].snapshot().map((n) => n.id));
    const deleted = new Set(logs.flatMap((l) => l.deleted));
    for (const created of logs.flatMap((l) => l.created)) {
      expect(ids.has(created), `seed ${seed}: note ${created}`).toBe(!deleted.has(created));
    }
  });
});

describe('BoardRoom joining (live.join_state)', () => {
  it('TC-14: a late joiner sees the 20 notes A and B created', async () => {
    const { boardId, a, b } = await pair();
    for (let i = 0; i < 10; i++) {
      const ida = createSticky(a.doc, { x: i * 220, y: 0 }, 'green');
      getStickyText(a.doc, ida)!.insert(0, `Alex idea ${i}`);
      const idb = createSticky(b.doc, { x: i * 220, y: 300 }, 'violet');
      getStickyText(b.doc, idb)!.insert(0, `Sam idea ${i}`);
    }
    await waitForConvergence([a, b]);
    const c = await connect(boardId);
    expect(c.snapshot()).toHaveLength(20);
    expect(c.snapshot()).toEqual(a.snapshot());
  });
});

describe('BoardRoom malformed traffic', () => {
  const invalidUpdate = (() => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    syncProtocol.writeUpdate(e, new Uint8Array([1, 1, 5, 0, 200]));
    return encoding.toUint8Array(e);
  })();
  const truncated = (() => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    encoding.writeVarUint(e, syncProtocol.messageYjsUpdate);
    encoding.writeVarUint(e, 50); // claims 50 bytes, sends 2
    encoding.writeUint8(e, 1);
    encoding.writeUint8(e, 2);
    return encoding.toUint8Array(e);
  })();
  const unknownType = (() => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 9);
    encoding.writeVarUint8Array(e, new Uint8Array([1, 2, 3]));
    return encoding.toUint8Array(e);
  })();
  const cases: [string, string | Uint8Array][] = [
    ['text frame', 'hello room'],
    ['truncated bytes', truncated],
    ['unknown type', unknownType],
    ['invalid Yjs update', invalidUpdate],
  ];
  for (const [name, frame] of cases) {
    it(`TC-15: ${name} closes only the sender with CLOSE_UNSUPPORTED_DATA; doc unchanged`, async () => {
      const { boardId, a, b } = await pairWithNote('keep me');
      const before = b.snapshot();
      a.sendRaw(frame);
      await waitFor(() => a.closeCode !== null, 'sender closed');
      expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
      const observer = await connect(boardId);
      expect(observer.snapshot()).toEqual(before);
      // B is still connected and still receives updates.
      expect(b.closeCode).toBeNull();
      const id = createSticky(observer.doc, { x: 5, y: 5 });
      await waitFor(() => b.snapshot().some((n) => n.id === id), 'B still receives');
      expect(b.closeCode).toBeNull();
    });
  }
});

describe('BoardRoom awareness relay', () => {
  it('TC-16: awareness bytes reach A and B identically', async () => {
    const { a, b } = await pair();
    const frame = encodeAwarenessFrame(new Uint8Array([1, 7, 1, 2, 3, 4, 5]));
    a.sendRaw(frame);
    const got = (c: TestClient) => c.received.find((m) => m.type === MESSAGE_AWARENESS && equalBytes(m.bytes, frame));
    await waitFor(() => !!got(a) && !!got(b), 'awareness relay');
    expect(Array.from(got(a)!.bytes)).toEqual(Array.from(frame));
    expect(Array.from(got(b)!.bytes)).toEqual(Array.from(frame));
  });
});

describe('BoardRoom restart and dead sockets', () => {
  it('TC-18: after a restart the first reconnecting client repopulates the room; others converge', async () => {
    const { a, b } = await pair();
    createSticky(a.doc, { x: 0, y: 0 }, 'orange');
    createSticky(b.doc, { x: 300, y: 0 }, 'pink');
    await waitForConvergence([a, b]);
    // Restart: every socket closes; the fresh instance has an empty doc.
    a.close();
    b.close();
    await waitFor(() => a.closeCode !== null && b.closeCode !== null, 'sockets closed');
    // B keeps editing locally while disconnected.
    const offline = createSticky(b.doc, { x: 600, y: 0 }, 'blue');
    const fresh = newBoardId();
    const a2 = await connect(fresh, a.doc);
    const observer = await connect(fresh);
    expect(observer.snapshot()).toEqual(a2.snapshot());
    expect(observer.snapshot()).toHaveLength(2);
    const b2 = await connect(fresh, b.doc);
    await waitForConvergence([a2, b2, observer]);
    expect(a2.snapshot().map((n) => n.id)).toContain(offline);
    expect(a2.snapshot()).toHaveLength(3);
  });

  it('TC-31: a socket that dies abruptly is dropped; the room keeps serving others', async () => {
    const { boardId, a, b } = await pair();
    b.ws.close(1001, 'gone');
    // A sends while the room may still hold B's socket.
    createSticky(a.doc, { x: 0, y: 0 });
    createSticky(a.doc, { x: 50, y: 0 });
    const c = await connect(boardId);
    expect(c.snapshot()).toHaveLength(2);
    const id = createSticky(a.doc, { x: 100, y: 0 });
    await waitFor(() => c.snapshot().some((n) => n.id === id), 'later socket receives');
    expect(a.closeCode).toBeNull();
  });
});
