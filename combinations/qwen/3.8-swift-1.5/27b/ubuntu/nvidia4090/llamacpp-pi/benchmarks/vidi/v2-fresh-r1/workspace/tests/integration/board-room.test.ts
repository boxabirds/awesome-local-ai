// Integration tests for the BoardRoom Durable Object in workerd: real
// Y.Doc, real y-protocols framing, real WebSockets. No mocks.
// TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS } from '../../src/shared/protocol';
import {
  closeAll,
  RoomClient,
  waitForConvergence,
} from './ws-client';
import { mulberry32, randomOps } from './random-ops';

function makeDoc(withNote?: { x: number; y: number; text?: string }): {
  doc: Y.Doc;
  noteId: string | null;
} {
  const doc = new Y.Doc();
  initDoc(doc);
  let noteId: string | null = null;
  if (withNote) {
    noteId = createSticky(doc, { x: withNote.x, y: withNote.y });
    if (withNote.text) {
      getStickyText(doc, noteId)?.insert(0, withNote.text);
    }
  }
  return { doc, noteId };
}

describe('board room sync', () => {
  it('TC-07: two clients exchange initial state; both see the same note', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    try {
      const noteId = createSticky(a.doc, { x: 10, y: 20 });
      await b.waitForUpdates(1);
      await waitForConvergence([a, b]);
      const aSnap = a.snapshot();
      const bSnap = b.snapshot();
      expect(bSnap.length).toBe(1);
      expect(bSnap[0].id).toBe(noteId);
      // Both clients see the exact same note (positions stored as
      // top-left world coords by the shared model).
      expect(bSnap[0].x).toBe(aSnap[0].x);
      expect(bSnap[0].y).toBe(aSnap[0].y);
      expect(aSnap[0].x).toBe(10 - 100); // STICKY_SIZE_WORLD / 2 offset
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);

  it('TC-08: concurrent text edits at different positions merge', async () => {
    const boardId = newBoardId();
    // Common base: one note with text "green"; both clients start from it.
    const base = new Y.Doc();
    initDoc(base);
    const noteId = createSticky(base, { x: 0, y: 0 });
    getStickyText(base, noteId)?.insert(0, 'green');
    const baseUpdate = Y.encodeStateAsUpdate(base);
    const docA = new Y.Doc();
    Y.applyUpdate(docA, baseUpdate);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, baseUpdate);

    const a = await RoomClient.connect(boardId, docA);
    const b = await RoomClient.connect(boardId, docB);
    try {
      // Live concurrent edits: A prepends, B appends.
      getStickyText(a.doc, noteId)?.insert(0, 'red ');
      getStickyText(b.doc, noteId)?.insert(
        getStickyText(b.doc, noteId)!.length,
        ' blue',
      );
      await waitForConvergence([a, b]);
      const textA = getStickyText(a.doc, noteId as string)!.toString();
      const textB = getStickyText(b.doc, noteId as string)!.toString();
      expect(textA).toBe('red green blue');
      expect(textB).toBe('red green blue');
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);

  it('TC-09: pre-built docs with concurrent edits converge after joining', async () => {
    const boardId = newBoardId();
    // Common base: one note with text "green".
    const base = new Y.Doc();
    initDoc(base);
    const noteId = createSticky(base, { x: 0, y: 0 });
    getStickyText(base, noteId)?.insert(0, 'green');
    const baseUpdate = Y.encodeStateAsUpdate(base);

    // A and B diverge from the same base.
    const docA = new Y.Doc();
    Y.applyUpdate(docA, baseUpdate);
    getStickyText(docA, noteId)?.insert(0, 'red ');
    const docB = new Y.Doc();
    Y.applyUpdate(docB, baseUpdate);
    getStickyText(docB, noteId)?.insert(
      getStickyText(docB, noteId)!.length,
      ' blue',
    );

    const a = await RoomClient.connect(boardId, docA);
    const b = await RoomClient.connect(boardId, docB);
    try {
      await waitForConvergence([a, b]);
      const textA = getStickyText(a.doc, noteId)!.toString();
      const textB = getStickyText(b.doc, noteId)!.toString();
      expect(textA).toBe('red green blue');
      expect(textB).toBe('red green blue');
      expect(a.snapshot().length).toBe(1);
      expect(b.snapshot().length).toBe(1);
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);

  it('TC-10: concurrent position sets resolve deterministically (same winner on both)', async () => {
    const boardId = newBoardId();
    const base = new Y.Doc();
    initDoc(base);
    const noteId = createSticky(base, { x: 0, y: 0 });
    const baseUpdate = Y.encodeStateAsUpdate(base);

    const docA = new Y.Doc();
    Y.applyUpdate(docA, baseUpdate);
    moveObject(docA, noteId, 100, 0);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, baseUpdate);
    moveObject(docB, noteId, 300, 0);

    const a = await RoomClient.connect(boardId, docA);
    const b = await RoomClient.connect(boardId, docB);
    try {
      await waitForConvergence([a, b]);
      const xA = a.snapshot()[0].x;
      const xB = b.snapshot()[0].x;
      // Both replicas must agree on the same winner (Yjs LWW).
      expect(xA).toBe(xB);
      expect([100, 300]).toContain(xA);
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);

  it('TC-11: delete during edit - note gone on both, edit text nowhere', async () => {
    const boardId = newBoardId();
    const base = new Y.Doc();
    initDoc(base);
    const noteId = createSticky(base, { x: 0, y: 0 });
    getStickyText(base, noteId)?.insert(0, 'hello');
    const baseUpdate = Y.encodeStateAsUpdate(base);

    const docA = new Y.Doc();
    Y.applyUpdate(docA, baseUpdate);
    deleteObject(docA, noteId);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, baseUpdate);
    getStickyText(docB, noteId)?.insert(
      getStickyText(docB, noteId)!.length,
      'BYE',
    );

    const a = await RoomClient.connect(boardId, docA);
    const b = await RoomClient.connect(boardId, docB);
    try {
      await waitForConvergence([a, b]);
      // The note is gone on both replicas.
      expect(a.snapshot().length).toBe(0);
      expect(b.snapshot().length).toBe(0);
      // B's edit text appears nowhere.
      for (const c of [a, b]) {
        for (const s of c.snapshot()) {
          expect(getStickyText(c.doc, s.id)?.toString()).not.toContain('BYE');
        }
      }
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);

  it('TC-12: sender gets no echo of its own update', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    try {
      // Let B's handshake (its schemaVersion) finish broadcasting so the
      // baseline count is stable.
      await a.waitForUpdates(1);
      const aUpdatesBefore = a.updates.length;
      createSticky(a.doc, { x: 5, y: 5 });
      await b.waitForUpdates(1);
      // A must not have received an echo of its own update.
      expect(a.updates.length).toBe(aUpdatesBefore);
      // Both agree on the board content.
      expect(a.snapshot().length).toBe(1);
      expect(b.snapshot().length).toBe(1);
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);
});

describe('board room protocol robustness', () => {
  it('TC-14: string frame closes only the sender with 1003', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    try {
      a.sendRaw('this is not a binary frame');
      const code = await a.waitForClose();
      expect(code).toBe(CLOSE_UNSUPPORTED_DATA);
      // B is unaffected and can still sync.
      expect(b.closeCode).toBeNull();
      createSticky(b.doc, { x: 1, y: 1 });
      // The room still works: a fresh participant syncs and sees the note
      // (initial state arrives as a sync step2, not an update frame).
      const c = await RoomClient.connect(boardId);
      try {
        await c.waitForFrame((f) => f[0] === 0 && f[1] === 1);
        expect(c.snapshot().length).toBe(1);
      } finally {
        await closeAll([c]);
      }
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);

  it('TC-15: truncated frame closes only the sender with 1003', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    try {
      // Build a real update frame, then cut it in half.
      const scratch = new Y.Doc();
      initDoc(scratch);
      createSticky(scratch, { x: 0, y: 0 });
      const full = Y.encodeStateAsUpdate(scratch);
      const frame = new Uint8Array(3 + full.length);
      frame[0] = 0; // sync
      frame[1] = 2; // update
      // varuint length (full.length < 128 so one byte)
      frame[2] = full.length;
      frame.set(full, 3);
      const truncated = frame.subarray(0, Math.floor(frame.length / 2));
      a.sendRaw(truncated);
      const code = await a.waitForClose();
      expect(code).toBe(CLOSE_UNSUPPORTED_DATA);
      // B is unaffected.
      expect(b.closeCode).toBeNull();
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);

  it('TC-16: awareness relayed verbatim to all sockets including the sender', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    try {
      const payload = new Uint8Array([9, 8, 7, 6]);
      a.sendAwareness(payload);
      // Both A and B must receive the identical awareness frame bytes
      // (the room relays the frame verbatim, varbytes framing included:
      // [MESSAGE_AWARENESS, varbytes(payload)]).
      await b.waitForFrame((f) => f[0] === MESSAGE_AWARENESS);
      const frameB = b.received.find((f) => f[0] === MESSAGE_AWARENESS);
      expect(frameB).toBeDefined();
      // payload length < 128, so the varbytes length prefix is one byte.
      expect(frameB![1]).toBe(payload.length);
      expect(Array.from(frameB!.subarray(2))).toEqual(Array.from(payload));
      // The sender gets the relay too (keeps its watchdog happy).
      await a.waitForFrame((f) => f[0] === MESSAGE_AWARENESS);
      const frameA = a.received.find((f) => f[0] === MESSAGE_AWARENESS);
      expect(frameA).toBeDefined();
      expect(Array.from(frameA!)).toEqual(Array.from(frameB!));
    } finally {
      await closeAll([a, b]);
    }
  }, 30_000);
});

describe('board room restart', () => {
  it('TC-18: restarted room is repopulated from storage; late joiner gets the note', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const noteId = createSticky(a.doc, { x: 42, y: 7 });
    await a.waitForFrames(1);

    // Simulate the Durable Object instance restarting: drop its in-memory
    // state so the next connection triggers a reload from storage.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as { doc: unknown; state: string };
      room.doc = null;
      room.state = 'storage-failed'; // triggers reload on next connection
    });
    a.close();

    // A reconnects; the room reloads from storage (which has the note).
    const a2 = await RoomClient.connect(boardId, a.doc);
    // A late joiner with an empty doc receives the note (as a sync step2).
    const b = await RoomClient.connect(boardId);
    try {
      await b.waitForFrame((f) => f[0] === 0 && f[1] === 1);
      await waitForConvergence([a2, b]);
      const bSnap = b.snapshot();
      expect(bSnap.length).toBe(1);
      expect(bSnap[0].id).toBe(noteId);
      // Positions are stored as top-left world coords (half-size offset).
      expect(bSnap[0].x).toBe(42 - 100);
      expect(bSnap[0].y).toBe(7 - 100);
    } finally {
      await closeAll([a2, b]);
    }
  }, 30_000);
});

describe('convergence stress', () => {
  it('TC-31: 500 random ops each from two participants converge to identical state', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    const b = await RoomClient.connect(boardId);
    try {
      const rngA = mulberry32(0x5eed);
      const rngB = mulberry32(0xbeef);
      randomOps(a.doc, 500, rngA);
      randomOps(b.doc, 500, rngB);
      await waitForConvergence([a, b], 30_000);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    } finally {
      await closeAll([a, b]);
    }
  }, 60_000);
});
