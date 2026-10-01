/**
 * Unit tests for undo.history (TC-01 to TC-11)
 */
import { describe, expect, it, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  moveObject,
  deleteObject,
  deleteObjects,
  setStickyColor,
  stickySnapshot as snapshot,
  getStickyText,
} from '../../src/shared/board-model';
import { createPeer, loadTransact, type Peer } from './helpers/peer';

let ctrl: UndoController | null = null;
let peer: Peer | null = null;
let doc: Y.Doc;

function setup(): Y.Doc {
  doc = new Y.Doc();
  return doc;
}

afterEach(() => {
  ctrl?.destroy();
  ctrl = null;
  peer?.destroy();
  peer = null;
  doc?.destroy();
});

describe('undo.history', () => {
  it('TC-01: local move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour', () => {
    setup();
    // Create two notes locally
    let idX = '', idZ = '';
    doc.transact(() => { idX = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);
    doc.transact(() => { idZ = createSticky(doc, { x: 300, y: 300 }); }, LOCAL_ORIGIN);
    // Record X's original position
    const origX = snapshot(doc).find((n) => n.id === idX)!.x;
    const origY = snapshot(doc).find((n) => n.id === idX)!.y;

    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Local move X
    moveObject(doc, idX, 500, 500);
    ctrl.boundary();

    // Peer creates Y and recolours Z (operating on peer's own doc)
    peer = createPeer(doc);
    peer.transact(() => {
      createSticky(peer!.doc, { x: 700, y: 700 });
    });
    peer.transact(() => {
      setStickyColor(peer!.doc, idZ, 'pink');
    });

    // Undo
    expect(ctrl.undo()).toBe(true);

    // X restored to original position
    const xNote = snapshot(doc).find((n) => n.id === idX)!;
    expect(xNote.x).toBe(origX);
    expect(xNote.y).toBe(origY);

    // Peer's note still exists (count > 2 because peer added one)
    const allNotes = snapshot(doc);
    expect(allNotes.length).toBeGreaterThanOrEqual(3);

    // Z keeps peer's colour
    const zNote = snapshot(doc).find((n) => n.id === idZ)!;
    expect(zNote.color).toBe('pink');
  });

  it('TC-02: only peer changes → canUndo false', () => {
    setup();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    peer = createPeer(doc);
    peer.transact(() => {
      createSticky(peer!.doc, { x: 100, y: 100 });
    });
    expect(ctrl.canUndo()).toBe(false);
  });

  it('TC-03: LOAD-origin updates → canUndo false', () => {
    setup();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    loadTransact(doc, () => {
      const objects = doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', new Y.Text());
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set('load-note', note);
    });
    expect(ctrl.canUndo()).toBe(false);
  });

  it('TC-04: delete 8 notes, undo → all restored with text, colour, size, position', () => {
    setup();
    const ids: string[] = [];
    const colors: Array<'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet'> =
      ['yellow', 'orange', 'green', 'blue', 'pink', 'violet', 'yellow', 'orange'];
    const positions: Array<{ x: number; y: number }> = [];

    doc.transact(() => {
      for (let i = 0; i < 8; i++) {
        const pos = { x: 100 + i * 250, y: 100 + i * 250 };
        positions.push(pos);
        const id = createSticky(doc, pos, colors[i]);
        ids.push(id);
        const text = getStickyText(doc, id);
        if (text) text.insert(0, `note ${i}`);
      }
    }, LOCAL_ORIGIN);

    // Record actual stored positions (createSticky centres)
    const beforeSnap = snapshot(doc);
    const actualPos = new Map<string, { x: number; y: number; color: string; text: string }>();
    for (const note of beforeSnap) {
      actualPos.set(note.id, { x: note.x, y: note.y, color: note.color, text: note.text });
    }

    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    ctrl.boundary();
    deleteObjects(doc, ids);
    ctrl.boundary();

    expect(snapshot(doc)).toHaveLength(0);

    // Undo
    expect(ctrl.undo()).toBe(true);
    const after = snapshot(doc);
    expect(after).toHaveLength(8);

    // Verify text, colour, position preserved
    for (let i = 0; i < 8; i++) {
      const note = after.find((n) => n.id === ids[i])!;
      expect(note).toBeTruthy();
      const orig = actualPos.get(ids[i])!;
      expect(note.x).toBe(orig.x);
      expect(note.y).toBe(orig.y);
      expect(note.color).toBe(orig.color);
      expect(note.text).toBe(`note ${i}`);
    }
  });

  it('TC-05: undo then redo → position re-applied', () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);
    const orig = snapshot(doc).find((n) => n.id === id)!;

    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    ctrl.boundary();
    moveObject(doc, id, 500, 600);
    ctrl.boundary();

    // Undo
    ctrl.undo();
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(orig.x);

    // Redo
    expect(ctrl.redo()).toBe(true);
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(500);
  });

  it('TC-06: undo then new change → canRedo false', () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);

    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    ctrl.boundary();
    moveObject(doc, id, 500, 500);
    ctrl.boundary();

    ctrl.undo();
    expect(ctrl.canRedo()).toBe(true);

    // New change
    ctrl.boundary();
    moveObject(doc, id, 200, 200);
    ctrl.boundary();

    expect(ctrl.canRedo()).toBe(false);
  });

  it('TC-07: local move, peer deletes target, undo → no throw, still deleted, next undo works', () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);
    let id2 = '';
    doc.transact(() => { id2 = createSticky(doc, { x: 300, y: 300 }); }, LOCAL_ORIGIN);

    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Move first note
    ctrl.boundary();
    moveObject(doc, id, 500, 500);
    ctrl.boundary();

    // Move second note
    ctrl.boundary();
    moveObject(doc, id2, 700, 700);
    ctrl.boundary();

    // Peer deletes the first note (operating on peer's own doc)
    peer = createPeer(doc);
    peer.transact(() => {
      deleteObject(peer!.doc, id);
    });

    // The first note is now gone
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();

    // Undo the second move (most recent step)
    const id2BeforeUndo = snapshot(doc).find((n) => n.id === id2)!.x;
    expect(id2BeforeUndo).toBe(700);
    expect(ctrl.undo()).toBe(true);
    // Restores to the position before the move (createSticky centers: 300-100=200)
    expect(snapshot(doc).find((n) => n.id === id2)!.x).toBe(200);

    // Undo the first move — targets deleted item, should not throw
    expect(ctrl.undo()).toBeDefined();
    // id remains deleted (undo of move should not recreate a deleted object)
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();
  });

  it('TC-08: peer edits note text, then local delete, undo → restored with content at time of delete', () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);
    const text = getStickyText(doc, id)!;
    text.insert(0, 'hello');

    ctrl = createUndo(doc, { captureTimeoutMs: 0 });

    // Peer edits the text (appending " world") on peer's own doc
    peer = createPeer(doc);
    peer.transact(() => {
      const t = getStickyText(peer!.doc, id);
      if (t) t.insert(5, ' world');
    });

    // Verify text is now "hello world" locally
    expect(getStickyText(doc, id)!.toString()).toBe('hello world');

    // Local delete
    ctrl.boundary();
    deleteObject(doc, id);
    ctrl.boundary();

    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();

    // Undo my delete → note restored with content as of delete time
    expect(ctrl.undo()).toBe(true);
    const restored = snapshot(doc).find((n) => n.id === id)!;
    expect(restored).toBeTruthy();
    expect(restored.text).toBe('hello world');
  });

  it('TC-09: UNDO_MAX_STEPS steps + 1 → length UNDO_MAX_STEPS, oldest dropped', () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);

    // Use a smaller maxSteps for test speed
    const max = 5;
    ctrl = createUndo(doc, { captureTimeoutMs: 0, maxSteps: max });

    // Add max + 1 steps
    for (let i = 0; i <= max; i++) {
      ctrl.boundary();
      moveObject(doc, id, (i + 1) * 10, 0);
      ctrl.boundary();
    }

    // Should have exactly `max` steps (oldest was dropped)
    // Undo all should succeed exactly `max` times
    for (let i = 0; i < max; i++) {
      expect(ctrl.undo()).toBe(true);
    }
    // After max undos, stack should be empty
    expect(ctrl.canUndo()).toBe(false);
  });

  it('TC-10: UNDO_MAX_STEPS − 1 + 1 → length UNDO_MAX_STEPS, nothing dropped', () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);

    // Use a smaller maxSteps for test speed
    const max = 5;
    ctrl = createUndo(doc, { captureTimeoutMs: 0, maxSteps: max });

    // Add exactly max steps
    for (let i = 0; i < max; i++) {
      ctrl.boundary();
      moveObject(doc, id, (i + 1) * 10, 0);
      ctrl.boundary();
    }

    // Undo all max steps should succeed (nothing dropped)
    for (let i = 0; i < max; i++) {
      expect(ctrl.undo()).toBe(true);
    }
    expect(ctrl.canUndo()).toBe(false);
    // Verify final position is back to original
    const note = snapshot(doc).find((n) => n.id === id)!;
    // Original position from createSticky: 100 - 100 = 0
    expect(note.x).toBe(0);
  });

  it('TC-11: destroy then new controller → canUndo false (session only)', () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);

    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    ctrl.boundary();
    moveObject(doc, id, 500, 500);
    ctrl.boundary();
    expect(ctrl.canUndo()).toBe(true);

    // Simulate reload: destroy and create new
    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    expect(ctrl.canUndo()).toBe(false);
  });
});
