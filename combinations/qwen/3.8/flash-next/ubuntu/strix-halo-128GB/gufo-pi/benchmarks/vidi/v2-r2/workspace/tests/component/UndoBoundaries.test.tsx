import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { type ReactElement, type ReactNode, useState, useEffect } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  setStickyColor,
  LOCAL_ORIGIN,
} from '@shared/board-model';
import { useSelection } from '@client/board/useSelection';
import { useTransformGesture } from '@client/board/useTransformGesture';
import { createUndo } from '@client/board/undo';
import type { Camera } from '@client/canvas/camera';

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };
const testCameraRef = { current: testCamera };

function TestWrapper({ children }: { children: ReactNode }): ReactElement {
  return <div data-board-viewport="true" style={{ position: 'fixed', inset: 0 }}>{children}</div>;
}

function useDocSnapshot(doc: Y.Doc) {
  const [snap, setSnap] = useState(() => snapshot(doc));
  useEffect(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const observer = () => setSnap(snapshot(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);
  return snap;
}

/**
 * Mock requestAnimationFrame to execute synchronously so that
 * scheduleFrame calls inside useTransformGesture fire immediately.
 */
function useSyncRaf() {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

// Helper: simulate a pointer event sequence for drag
function simulateDrag(
  startEl: Element,
  startX: number,
  startY: number,
  dx: number,
  dy: number,
  frames = 10,
) {
  const pointerId = 1;
  // pointerdown
  fireEvent(startEl, new window.PointerEvent('pointerdown', {
    bubbles: true,
    clientX: startX,
    clientY: startY,
    pointerId,
    button: 0,
  }));

  // pointermove frames (exceeds DRAG_THRESHOLD_PX = 3)
  for (let i = 1; i <= frames; i++) {
    fireEvent(window, new window.PointerEvent('pointermove', {
      bubbles: true,
      clientX: startX + (dx * i) / frames,
      clientY: startY + (dy * i) / frames,
      pointerId,
    }));
  }

  // pointerup
  fireEvent(window, new window.PointerEvent('pointerup', {
    bubbles: true,
    pointerId,
  }));
}

// ============================================================
// TC-14: 30-frame drag → one undo restores start positions
// ============================================================
describe('TC-14: drag is one undo step', () => {
  useSyncRaf();

  it('30-frame drag of selection → one undo restores every object start position', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    // Create 3 stickies to drag
    const idA = createSticky(doc, { x: 100, y: 100 });
    createSticky(doc, { x: 350, y: 100 });
    const idC = createSticky(doc, { x: 600, y: 100 });

    // Positions after creation
    const snapBefore = snapshot(doc);
    const posA = snapBefore.find((n) => n.id === idA)!;
    const posC = snapBefore.find((n) => n.id === idC)!;
    const origA = { x: posA.x, y: posA.y };
    const origC = { x: posC.x, y: posC.y };

    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });

    function TestComp(): ReactElement {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const { onObjectPointerDown } = useTransformGesture({
        doc,
        cameraRef: testCameraRef,
        selection,
        snapshot: snap,
        canEdit: true,
        onGestureStart: () => ctrl.boundary(),
        onGestureEnd: () => ctrl.boundary(),
      });

      // Select all objects
      useEffect(() => {
        selection.setMany([idA, idC], false);
      }, []);

      return (
        <TestWrapper>
          {snap.map((note) => (
            <div
              key={note.id}
              data-testid={`note-${note.id}`}
              data-x={note.x}
              data-y={note.y}
              style={{ position: 'absolute', left: note.x, top: note.y, width: 200, height: 200 }}
              onPointerDown={(e) => onObjectPointerDown(e.nativeEvent, note.id)}
            />
          ))}
        </TestWrapper>
      );
    }

    const { getByTestId } = render(<TestComp />);
    const elA = getByTestId(`note-${idA}`);

    // Drag object A by (300, 200) over 30 frames
    act(() => {
      simulateDrag(elA, 50, 50, 300, 200, 30);
    });

    // Positions should have moved
    const snapAfterDrag = snapshot(doc);
    const movedA = snapAfterDrag.find((n) => n.id === idA)!;
    expect(movedA.x).not.toBe(origA.x);

    // One undo should restore all positions
    expect(ctrl.canUndo()).toBe(true);
    act(() => {
      ctrl.undo();
    });

    const snapAfterUndo = snapshot(doc);
    const restoredA = snapAfterUndo.find((n) => n.id === idA)!;
    const restoredC = snapAfterUndo.find((n) => n.id === idC)!;
    expect(restoredA.x).toBe(origA.x);
    expect(restoredA.y).toBe(origA.y);
    expect(restoredC.x).toBe(origC.x);
    expect(restoredC.y).toBe(origC.y);

    ctrl.destroy();
    doc.destroy();
  });
});

// ============================================================
// TC-15: drag ends, colour changed later → two separate steps
// ============================================================
describe('TC-15: gesture boundary separates steps', () => {
  useSyncRaf();

  it('drag then colour change → two separate undo steps', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const idA = createSticky(doc, { x: 100, y: 100 });
    const snapBefore = snapshot(doc);
    const origPos = { x: snapBefore[0].x, y: snapBefore[0].y };

    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });

    function TestComp(): ReactElement {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const { onObjectPointerDown } = useTransformGesture({
        doc,
        cameraRef: testCameraRef,
        selection,
        snapshot: snap,
        canEdit: true,
        onGestureStart: () => ctrl.boundary(),
        onGestureEnd: () => ctrl.boundary(),
      });

      useEffect(() => {
        selection.setMany([idA], false);
      }, []);

      return (
        <TestWrapper>
          <div
            data-testid={`note-${idA}`}
            style={{ position: 'absolute', left: snap[0]?.x ?? 0, top: snap[0]?.y ?? 0, width: 200, height: 200 }}
            onPointerDown={(e) => onObjectPointerDown(e.nativeEvent, idA)}
          />
        </TestWrapper>
      );
    }

    const { getByTestId } = render(<TestComp />);
    const el = getByTestId(`note-${idA}`);

    // Drag
    act(() => {
      simulateDrag(el, 50, 50, 200, 100, 5);
    });

    // Force the capture window to expire so the next action is a new step
    (ctrl._um as any).lastChange = 0;

    // Change colour
    act(() => {
      setStickyColor(doc, idA, 'green');
      ctrl.boundary();
    });

    // Should have 2 undo steps
    expect(ctrl.canUndo()).toBe(true);

    // First undo: undoes colour
    act(() => {
      ctrl.undo();
    });
    const afterFirstUndo = snapshot(doc).find((n) => n.id === idA)!;
    expect(afterFirstUndo.color).toBe('yellow'); // original colour restored
    // Still moved (not yet undone)
    expect(afterFirstUndo.x).not.toBe(origPos.x);

    // Second undo: undoes move
    expect(ctrl.canUndo()).toBe(true);
    act(() => {
      ctrl.undo();
    });
    const afterSecondUndo = snapshot(doc).find((n) => n.id === idA)!;
    expect(afterSecondUndo.x).toBe(origPos.x);
    expect(afterSecondUndo.y).toBe(origPos.y);

    ctrl.destroy();
    doc.destroy();
  });
});

// ============================================================
// TC-16: Ctrl+Z inside editor undoes typing, not earlier move
// ============================================================
describe('TC-16: Ctrl+Z in editor undoes typing only', () => {
  it('type in editor, Ctrl+Z → typing undone, earlier move preserved', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const idA = createSticky(doc, { x: 100, y: 100 });
    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });

    // First: move the note (one step)
    act(() => {
      ctrl.boundary();
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(idA)!;
      doc.transact(() => {
        obj.set('x', 500);
        obj.set('y', 500);
      }, LOCAL_ORIGIN);
      ctrl.boundary();
    });

    const movedPos = snapshot(doc).find((n) => n.id === idA)!;
    expect(movedPos.x).toBe(500);

    // Now simulate editing: type text
    const ytext = (doc.getMap<Y.Map<unknown>>('objects').get(idA)!.get('text') as Y.Text);

    act(() => {
      ctrl.boundary(); // edit start
      doc.transact(() => {
        ytext.insert(0, 'hello');
      }, LOCAL_ORIGIN);
    });

    // Force capture window to expire so next undo targets the typing step only
    (ctrl._um as any).lastChange = 0;

    // Simulate Ctrl+Z in editor (calls undo)
    act(() => {
      ctrl.undo();
    });

    // Typing should be undone
    expect(ytext.toString()).toBe('');
    // Move should still be there (note still at 500,500)
    const afterUndo = snapshot(doc).find((n) => n.id === idA)!;
    expect(afterUndo.x).toBe(500);
    expect(afterUndo.y).toBe(500);

    ctrl.destroy();
    doc.destroy();
  });
});

// ============================================================
// TC-17: pointercancel mid-drag → one step restoring start position
// ============================================================
describe('TC-17: cancelled drag is one undo step', () => {
  useSyncRaf();

  it('pointercancel mid-drag → one undo restores start position', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const idA = createSticky(doc, { x: 100, y: 100 });
    const snapBefore = snapshot(doc);
    const origPos = { x: snapBefore[0].x, y: snapBefore[0].y };

    const ctrl = createUndo(doc, { captureTimeoutMs: 500 });

    function TestComp(): ReactElement {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const { onObjectPointerDown } = useTransformGesture({
        doc,
        cameraRef: testCameraRef,
        selection,
        snapshot: snap,
        canEdit: true,
        onGestureStart: () => ctrl.boundary(),
        onGestureEnd: () => ctrl.boundary(),
      });

      useEffect(() => {
        selection.setMany([idA], false);
      }, []);

      return (
        <TestWrapper>
          <div
            data-testid={`note-${idA}`}
            style={{ position: 'absolute', left: snap[0]?.x ?? 0, top: snap[0]?.y ?? 0, width: 200, height: 200 }}
            onPointerDown={(e) => onObjectPointerDown(e.nativeEvent, idA)}
          />
        </TestWrapper>
      );
    }

    const { getByTestId } = render(<TestComp />);
    const el = getByTestId(`note-${idA}`);
    const pointerId = 1;

    // Start drag
    fireEvent(el, new window.PointerEvent('pointerdown', {
      bubbles: true,
      clientX: 50,
      clientY: 50,
      pointerId,
      button: 0,
    }));

    // Move past threshold (> 3px)
    for (let i = 1; i <= 5; i++) {
      fireEvent(window, new window.PointerEvent('pointermove', {
        bubbles: true,
        clientX: 50 + i * 20,
        clientY: 50 + i * 10,
        pointerId,
      }));
    }

    // Cancel
    fireEvent(window, new window.PointerEvent('pointercancel', {
      bubbles: true,
      pointerId,
    }));

    // Position moved
    const afterDrag = snapshot(doc).find((n) => n.id === idA)!;
    expect(afterDrag.x).not.toBe(origPos.x);

    // One undo restores start
    expect(ctrl.canUndo()).toBe(true);
    act(() => {
      ctrl.undo();
    });

    const afterUndo = snapshot(doc).find((n) => n.id === idA)!;
    expect(afterUndo.x).toBe(origPos.x);
    expect(afterUndo.y).toBe(origPos.y);

    ctrl.destroy();
    doc.destroy();
  });
});
