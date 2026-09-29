import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { createUndo, UndoController } from '@client/board/undo';
import { useUndo } from '@client/board/useUndo';
import { UndoButtons } from '@client/board/UndoButtons';
import {
  LOCAL_ORIGIN,
  createSticky,
  moveObjects,
  setStickyColor,
  getStickyText,
  snapshot,
  deleteObjects,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD } from '@shared/config';

const HALF = STICKY_SIZE_WORLD / 2;

describe('TC-14: 30-frame drag → one undo step restoring start position', () => {
  afterEach(cleanup);

  it('simulates a drag as multiple moveObjects transactions bounded by boundary() → one step', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    let id = '';
    doc.transact(() => {
      id = createSticky(doc, { x: HALF, y: HALF }); // stored at (0,0)
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Simulate 30 frames of a drag: each frame is a moveObjects call with LOCAL_ORIGIN
    ctrl.boundary(); // onGestureStart
    for (let frame = 0; frame < 30; frame++) {
      const x = frame * 10;
      doc.transact(() => {
        moveObjects(doc, new Map([[id, { x, y: 0 }]]));
      }, LOCAL_ORIGIN);
    }
    ctrl.boundary(); // onGestureEnd

    // Should be 2 steps: creation + merged drag
    expect(ctrl.undoStackLength()).toBe(2);

    // Undo the drag → back to initial position
    ctrl.undo();
    const snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.x).toBe(0);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-15: move then colour within 200ms → two separate steps (boundary at gesture end)', () => {
  afterEach(cleanup);

  it('boundary separates gesture from subsequent colour change', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    let id = '';
    doc.transact(() => {
      id = createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Drag (gesture)
    ctrl.boundary();
    for (let frame = 0; frame < 5; frame++) {
      doc.transact(() => {
        moveObjects(doc, new Map([[id, { x: frame * 20, y: 0 }]]));
      }, LOCAL_ORIGIN);
    }
    ctrl.boundary(); // onGestureEnd

    // Immediately change colour (within 200ms — but boundary prevents merge)
    doc.transact(() => {
      setStickyColor(doc, id, 'blue');
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // 3 steps: creation + drag + colour
    expect(ctrl.undoStackLength()).toBe(3);

    // Undo colour → back to yellow
    ctrl.undo();
    let snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.color).toBe('yellow');

    // Undo drag → back to start position
    ctrl.undo();
    snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.x).toBe(0);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-16: Ctrl+Z inside editor undoes typing, not earlier move', () => {
  afterEach(cleanup);

  it('typing inside StickyTextEditor is a separate step from an earlier move', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    let id = '';
    doc.transact(() => {
      id = createSticky(doc, { x: HALF, y: HALF });
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Move the note
    doc.transact(() => {
      moveObjects(doc, new Map([[id, { x: 300, y: 300 }]]));
    }, LOCAL_ORIGIN);
    ctrl.boundary(); // end of move

    // Simulate editing (boundary at edit start)
    ctrl.boundary(); // edit start boundary
    const ytext = getStickyText(doc, id)!;
    doc.transact(() => {
      ytext.insert(0, 'Hello');
    }, LOCAL_ORIGIN);
    ctrl.boundary(); // edit end boundary

    // 3 steps: creation + move + typing
    expect(ctrl.undoStackLength()).toBe(3);

    // Undo typing (Ctrl+Z inside editor would do this)
    ctrl.undo();
    expect(ytext.toString()).toBe('');

    // The move is still in effect
    let snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.x).toBe(300);

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-17: pointercancel mid-drag → one step restoring start', () => {
  afterEach(cleanup);

  it('partial drag with pointercancel boundary is one step', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);

    let id = '';
    doc.transact(() => {
      id = createSticky(doc, { x: HALF, y: HALF }); // stored (0,0)
    }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Simulate a drag that is cancelled (pointercancel calls onGestureEnd → boundary)
    ctrl.boundary(); // onGestureStart
    for (let frame = 0; frame < 5; frame++) {
      doc.transact(() => {
        moveObjects(doc, new Map([[id, { x: frame * 10, y: frame * 10 }]]));
      }, LOCAL_ORIGIN);
    }
    ctrl.boundary(); // onGestureEnd (pointercancel)

    // 2 steps: creation + partial drag
    expect(ctrl.undoStackLength()).toBe(2);

    // Undo the partial drag → back to (0,0)
    ctrl.undo();
    const snap = snapshot(doc);
    expect(snap.find(o => o.id === id)!.x).toBe(0);
    expect(snap.find(o => o.id === id)!.y).toBe(0);

    ctrl.destroy();
    doc.destroy();
  });
});
