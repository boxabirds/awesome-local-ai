// Story 3, sync.room integration tests: a real BoardRoom Durable Object with
// real WebSockets and real Yjs docs (via SELF.fetch). No mocks.
//
// TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31.

import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { moveObject, setStickyColor, deleteObject, getStickyText, createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { randomOps } from '../fixtures/random-ops';
import { RoomClient, createNote, makeStickyDoc, replicate, type ReceivedMessage } from './ws-client';

const room = (): string => newBoardId();

/** True when two clients' board snapshots are identical. */
function sameNotes(a: RoomClient, b: RoomClient): boolean {
  const na = a.notes;
  const nb = b.notes;
  if (na.length !== nb.length) return false;
  for (let i = 0; i < na.length; i++) {
    if (JSON.stringify(na[i]) !== JSON.stringify(nb[i])) return false;
  }
  return true;
}

async function notesInclude(client: RoomClient, id: string): Promise<void> {
  await vi.waitFor(() => {
    expect(client.notes.map((n) => n.id)).toContain(id);
  });
}

async function noteGone(client: RoomClient, id: string): Promise<void> {
  await vi.waitFor(() => {
    expect(client.notes.map((n) => n.id)).not.toContain(id);
  });
}

function receivedAwareness(client: RoomClient): ReceivedMessage[] {
  return client.messages.filter((m) => m.type === 1);
}

describe('sync.room', () => {
  it('TC-07: A creates a sticky -> B snapshot equals A; B received exactly one update', async () => {
    const id = room();
    const a = await RoomClient.connect(id);
    await a.waitForSync();
    const b = await RoomClient.connect(id);
    await b.waitForSync();

    const bMark = b.messages.length;
    const noteId = createNote(a, 50, 50);
    await notesInclude(b, noteId);

    expect(b.updateMessages(bMark)).toHaveLength(1);
    expect(sameNotes(a, b)).toBe(true);

    a.close();
    b.close();
  });

  it('TC-08a: move propagates; sender receives no echo', async () => {
    const { a, b, noteId, cleanup } = await setupWithNote();
    const aMark = a.messages.length;
    expect(moveObject(a.doc, noteId, 10, 20)).toBe(true);
    await vi.waitFor(() => {
      expect(b.notes.find((n) => n.id === noteId)).toMatchObject({ x: 10, y: 20 });
    });
    expect(a.updateMessages(aMark)).toHaveLength(0); // no echo to sender
    cleanup();
  });

  it('TC-08b: recolour propagates; sender receives no echo', async () => {
    const { a, b, noteId, cleanup } = await setupWithNote();
    const aMark = a.messages.length;
    expect(setStickyColor(a.doc, noteId, 'blue')).toBe(true);
    await vi.waitFor(() => {
      expect(b.notes.find((n) => n.id === noteId)?.color).toBe('blue');
    });
    expect(a.updateMessages(aMark)).toHaveLength(0);
    cleanup();
  });

  it('TC-08c: text insert propagates; sender receives no echo', async () => {
    const { a, b, noteId, cleanup } = await setupWithNote();
    const aMark = a.messages.length;
    getStickyText(a.doc, noteId)?.insert(0, 'hello');
    await vi.waitFor(() => {
      expect(b.notes.find((n) => n.id === noteId)?.text).toBe('hello');
    });
    expect(a.updateMessages(aMark)).toHaveLength(0);
    cleanup();
  });

  it('TC-08d: delete propagates; sender receives no echo', async () => {
    const { a, b, noteId, cleanup } = await setupWithNote();
    const aMark = a.messages.length;
    expect(deleteObject(a.doc, noteId)).toBe(true);
    await noteGone(b, noteId);
    expect(a.updateMessages(aMark)).toHaveLength(0);
    cleanup();
  });

  it("TC-09: concurrent text inserts merge ('red ' + 'green' + ' blue' -> 'red green blue')", async () => {
    const id = 'sticky-1';
    // Shared base: both clients edit the SAME 'green' items so the merge is
    // a pure concurrent-insert merge.
    const base = makeStickyDoc(id, 'green');
    const docA = replicate(base);
    getStickyText(docA, id)?.insert(0, 'red '); // 'red green'
    const docB = replicate(base);
    const textB = getStickyText(docB, id)!;
    textB.insert(textB.length, ' blue'); // 'green blue'

    const rid = room();
    const a = await RoomClient.connect(rid, docA);
    const b = await RoomClient.connect(rid, docB);
    await a.waitForSync();
    await b.waitForSync();
    await vi.waitFor(() => {
      expect(a.notes.find((n) => n.id === id)?.text).toBe('red green blue');
    });
    expect(a.notes.find((n) => n.id === id)?.text).toBe(
      b.notes.find((n) => n.id === id)?.text,
    );
    a.close();
    b.close();
  });

  it('TC-10: concurrent position sets converge to the same x on both clients', async () => {
    const id = 'sticky-1';
    const docA = makeStickyDoc(id, '', 0, 0);
    moveObject(docA, id, 100, 0);
    const docB = makeStickyDoc(id, '', 0, 0);
    moveObject(docB, id, 300, 0);

    const rid = room();
    const a = await RoomClient.connect(rid, docA);
    const b = await RoomClient.connect(rid, docB);
    await a.waitForSync();
    await b.waitForSync();
    await vi.waitFor(() => {
      expect(sameNotes(a, b)).toBe(true);
    });
    const xA = a.notes.find((n) => n.id === id)?.x;
    const xB = b.notes.find((n) => n.id === id)?.x;
    expect(xA).toBe(xB);
    expect([100, 300]).toContain(xA);
    a.close();
    b.close();
  });

  it("TC-11: delete wins over concurrent text insert; note is not resurrected", async () => {
    const id = 'sticky-1';
    // Shared base: A deletes the very entry that B is typing into.
    const base = makeStickyDoc(id, 'green');
    const docA = replicate(base);
    deleteObject(docA, id);
    const docB = replicate(base);
    getStickyText(docB, id)?.insert(0, 'hello ');

    const rid = room();
    const a = await RoomClient.connect(rid, docA);
    const b = await RoomClient.connect(rid, docB);
    await a.waitForSync();
    await b.waitForSync();
    await vi.waitFor(() => {
      expect(a.notes).toHaveLength(0);
    });
    expect(a.notes).toHaveLength(0);
    expect(b.notes).toHaveLength(0);
    // B's text is present nowhere.
    for (const client of [a, b]) {
      for (const note of client.notes) {
        expect(note.text).not.toContain('hello');
      }
    }
    a.close();
    b.close();
  });

  it(`TC-12: ${MAX_CONCURRENT_EDITORS} clients x 200 seeded random ops -> identical snapshots`, async () => {
    const seedBase = 42;
    console.log(`TC-12 seed base: ${seedBase}`);
    const rid = room();
    const clients: RoomClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const doc = new Y.Doc();
      randomOps(doc, seedBase + i, 200);
      const client = await RoomClient.connect(rid, doc);
      clients.push(client);
    }
    for (const client of clients) await client.waitForSync();
    await vi.waitFor(() => {
      for (const client of clients.slice(1)) {
        expect(sameNotes(clients[0], client)).toBe(true);
      }
    });
    // Every snapshot is identical; hence every created note is present on
    // all clients unless its doc's ops deleted it.
    clients.forEach((c) => c.close());
  }, 30_000);

  it('TC-14: late joiner C sees the current board (20 notes) after initial sync', async () => {
    const rid = room();
    const docA = new Y.Doc();
    for (let i = 0; i < 10; i++) createNoteFromDoc(docA, i * 25 + 10);
    const docB = new Y.Doc();
    for (let i = 0; i < 10; i++) createNoteFromDoc(docB, i * 25 + 10);

    const a = await RoomClient.connect(rid, docA);
    const b = await RoomClient.connect(rid, docB);
    await a.waitForSync();
    await b.waitForSync();
    await vi.waitFor(() => {
      expect(a.notes).toHaveLength(20);
      expect(b.notes).toHaveLength(20);
    });

    const c = await RoomClient.connect(rid);
    await c.waitForSync();
    await vi.waitFor(() => {
      expect(sameNotes(c, a)).toBe(true);
    });
    expect(c.notes).toHaveLength(20);

    a.close();
    b.close();
    c.close();
  });

  describe('TC-15: malformed traffic from A', () => {
    it.each([
      ['string frame', (a: RoomClient) => a.sendRaw('hello world')],
      [
        'truncated bytes',
        (a: RoomClient) => a.sendRaw(new Uint8Array([0x00, 0x81, 0x80]).buffer),
      ],
      ['unknown type 9', (a: RoomClient) => a.sendFramed(9, new Uint8Array(0))],
      [
        'invalid Yjs update',
        (a: RoomClient) => {
          const inner = createEncoder();
          writeVarUint(inner, sync.messageYjsUpdate);
          writeVarUint8Array(inner, new Uint8Array([1, 2, 3, 4]));
          a.sendSync(toUint8Array(inner));
        },
      ],
    ])('%s -> A closed with 1003, B unaffected, room doc unchanged', async (_label, send) => {
      const rid = room();
      const b = await RoomClient.connect(rid);
      await b.waitForSync();
      createNote(b, 7, 7); // give the room some state
      await vi.waitFor(() => expect(b.notes).toHaveLength(1));
      const baseline = b.notes.map((n) => JSON.stringify(n)).sort();

      const a = await RoomClient.connect(rid);
      await a.waitForSync();
      send(a);
      const close = await a.waitForClose();
      expect(close.code).toBe(1003);

      // B is still open, still receives updates, room doc unchanged.
      expect(b.isOpen).toBe(true);
      expect(b.notes.map((n) => JSON.stringify(n)).sort()).toEqual(baseline);
      const c = await RoomClient.connect(rid);
      await c.waitForSync();
      await vi.waitFor(() => {
        expect(sameNotes(c, b)).toBe(true);
      });

      b.close();
      c.close();
    });
  });

  it('TC-16: awareness bytes are relayed verbatim to all sockets including sender', async () => {
    const rid = room();
    const a = await RoomClient.connect(rid);
    await a.waitForSync();
    const b = await RoomClient.connect(rid);
    await b.waitForSync();

    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3]);
    a.sendAwareness(payload);

    const fa = await receiveAwareness(a);
    const fb = await receiveAwareness(b);
    expect(Array.from(fa.payload)).toEqual(Array.from(payload));
    expect(Array.from(fb.payload)).toEqual(Array.from(payload));
    expect(Array.from(fa.payload)).toEqual(Array.from(fb.payload));

    a.close();
    b.close();
  });

  it('TC-18: room restart — first reconnector repopulates the fresh room, others converge', async () => {
    const rid1 = room();
    const a = await RoomClient.connect(rid1);
    await a.waitForSync();
    const b = await RoomClient.connect(rid1);
    await b.waitForSync();
    for (let i = 0; i < 3; i++) createNote(a, i * 30 + 5, i * 30 + 5);
    for (let i = 0; i < 2; i++) createNote(b, i * 40 + 15, i * 40 + 15);
    await vi.waitFor(() => {
      expect(a.notes).toHaveLength(5);
      expect(b.notes).toHaveLength(5);
    });
    a.close();
    b.close();

    // Fresh object (simulated restart): A reconnects first with its doc.
    const rid2 = room();
    const a2 = await RoomClient.connect(rid2, a.doc);
    await a2.waitForSync();
    const b2 = await RoomClient.connect(rid2, b.doc);
    await b2.waitForSync();
    await vi.waitFor(() => {
      expect(a2.notes).toHaveLength(5);
      expect(b2.notes).toHaveLength(5);
      expect(sameNotes(a2, b2)).toBe(true);
    });

    a2.close();
    b2.close();
  });

  it('TC-31: dead socket dropped on failed send; later sockets still receive', async () => {
    const rid = room();
    const a = await RoomClient.connect(rid);
    await a.waitForSync();
    const b = await RoomClient.connect(rid);
    await b.waitForSync();
    b.close(); // B's socket dies
    await vi.waitFor(() => expect(b.isOpen).toBe(false));

    const id = createNote(a, 9, 9);
    const c = await RoomClient.connect(rid);
    await c.waitForSync();
    await notesInclude(c, id);

    a.close();
    c.close();
  });
});

/** Two synced clients sharing a room, with one note created by A. */
async function setupWithNote() {
  const rid = room();
  const a = await RoomClient.connect(rid);
  await a.waitForSync();
  const b = await RoomClient.connect(rid);
  await b.waitForSync();
  const noteId = createNote(a, 50, 50);
  await notesInclude(b, noteId);
  return {
    a,
    b,
    noteId,
    cleanup: () => {
      a.close();
      b.close();
    },
  };
}

function createNoteFromDoc(doc: Y.Doc, x: number): string {
  const id = createSticky(doc, { x, y: x });
  if (id === '') throw new Error('createSticky failed');
  return id;
}

async function receiveAwareness(client: RoomClient): Promise<ReceivedMessage> {
  // The relay is near-instant, so simply wait for the first awareness frame.
  await vi.waitFor(() => {
    expect(receivedAwareness(client).length).toBeGreaterThanOrEqual(1);
  });
  return receivedAwareness(client)[0];
}
