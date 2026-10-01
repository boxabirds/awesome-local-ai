import { describe, expect, it, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  setStickyColor,
  snapshot,
  getStickyText,
} from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';

describe('undo.boundaries (gestures)', () => {
  afterEach(() => {
    // cleanup handled per test
  });

  // TC-14: 30-frame drag via useTransformGesture → one undo restores start position
  it('TC-14: drag with 30 frames is one undo step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 150, y: 150 });

    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });
    ctrl.boundary(); // close creation step

    const startPos1 = { x: snapshot(doc).find(s => s.id === id1)!.x, y: snapshot(doc).find(s => s.id === id1)!.y };
    const startPos2 = { x: snapshot(doc).find(s => s.id === id2)!.x, y: snapshot(doc).find(s => s.id === id2)!.y };

    ctrl.boundary(); // onGestureStart

    // Simulate 30 frames of movement (each in its own LOCAL_ORIGIN transaction, but within capture window)
    for (let frame = 1; frame <= 30; frame++) {
      const dx = frame * 2;
      const dy = frame * 1;
      doc.transact(() => {
        const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
        const m1 = objects.get(id1);
        const m2 = objects.get(id2);
        if (m1) { m1.set('x', startPos1.x + dx); m1.set('y', startPos1.y + dy); }
        if (m2) { m2.set('x', startPos2.x + dx); m2.set('y', startPos2.y + dy); }
      }, LOCAL_ORIGIN);
    }

    ctrl.boundary(); // onGestureEnd

    // One undo should restore both notes to start
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();

    const afterSnap = snapshot(doc);
    const note1 = afterSnap.find(s => s.id === id1)!;
    const note2 = afterSnap.find(s => s.id === id2)!;
    expect(note1.x).toBe(startPos1.x);
    expect(note1.y).toBe(startPos1.y);
    expect(note2.x).toBe(startPos2.x);
    expect(note2.y).toBe(startPos2.y);

    ctrl.destroy();
    doc.destroy();
  });

  // TC-15: drag ends, colour changed later → two separate steps
  it('TC-15: gesture end + colour change are two separate steps', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });

    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });
    ctrl.boundary(); // close creation step

    const startPos = { x: snapshot(doc).find(s => s.id === id)!.x, y: snapshot(doc).find(s => s.id === id)!.y };

    // Simulate gesture: boundary, move, boundary
    ctrl.boundary(); // gesture start
    moveObjects(doc, new Map([[id, { x: startPos.x + 50, y: startPos.y + 50 }]]));
    ctrl.boundary(); // gesture end

    // Colour change (boundary before and after to make it a separate step)
    ctrl.boundary();
    setStickyColor(doc, id, 'pink');
    ctrl.boundary();

    // Undo the colour change
    ctrl.undo();
    let note = snapshot(doc).find(s => s.id === id)!;
    expect(note.color).not.toBe('pink'); // colour restored
    expect(note.x).toBe(startPos.x + 50); // still moved

    // Undo the move
    ctrl.undo();
    note = snapshot(doc).find(s => s.id === id)!;
    expect(note.x).toBe(startPos.x);
    expect(note.y).toBe(startPos.y);

    ctrl.destroy();
    doc.destroy();
  });

  // TC-16: edit note, type "hello", undo → typing undone; earlier move NOT undone
  it('TC-16: undo in editor undoes typing, not earlier move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });

    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });

    // Close creation step
    ctrl.boundary();

    // Simulate a move (one step)
    const startPos = { x: snapshot(doc).find(s => s.id === id)!.x, y: snapshot(doc).find(s => s.id === id)!.y };
    ctrl.boundary(); // gesture start
    moveObjects(doc, new Map([[id, { x: startPos.x + 100, y: startPos.y + 100 }]]));
    ctrl.boundary(); // gesture end

    // Simulate editing: boundary at start
    ctrl.boundary(); // edit start

    // Type "hello"
    const text = getStickyText(doc, id)!;
    doc.transact(() => text.insert(0, 'hello'), LOCAL_ORIGIN);
    ctrl.boundary(); // edit end

    // Undo the typing
    ctrl.undo();
    expect(text.toString()).toBe(''); // typing undone

    // The move should NOT be undone yet
    const note = snapshot(doc).find(s => s.id === id)!;
    expect(note.x).toBe(startPos.x + 100); // still at moved position

    ctrl.destroy();
    doc.destroy();
  });

  // TC-17: pointercancel mid-drag → one step restoring start
  it('TC-17: cancelled gesture is one undo step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });

    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });
    ctrl.boundary(); // close creation step

    const startPos = { x: snapshot(doc).find(s => s.id === id)!.x, y: snapshot(doc).find(s => s.id === id)!.y };

    // Simulate cancelled gesture: boundary at start, some moves, boundary at cancel
    ctrl.boundary(); // gesture start
    moveObjects(doc, new Map([[id, { x: startPos.x + 30, y: startPos.y + 30 }]]));
    moveObjects(doc, new Map([[id, { x: startPos.x + 60, y: startPos.y + 60 }]]));
    ctrl.boundary(); // gesture end (on pointercancel)

    // One undo should restore start position
    ctrl.undo();
    const note = snapshot(doc).find(s => s.id === id)!;
    expect(note.x).toBe(startPos.x);
    expect(note.y).toBe(startPos.y);

    ctrl.destroy();
    doc.destroy();
  });
});
