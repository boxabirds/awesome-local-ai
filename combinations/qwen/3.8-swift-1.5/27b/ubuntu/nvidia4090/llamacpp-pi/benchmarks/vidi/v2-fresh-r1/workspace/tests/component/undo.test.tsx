// Component tests for story 8: undo/redo boundaries, shortcuts, buttons, edit lock.
// TC-14 to TC-21.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { useEffect, useRef, useState } from 'react';
import {
  createSticky,
  moveObjects,
  deleteObjects,
  setStickyColor,
  snapshot,
  initDoc,
  LOCAL_ORIGIN,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useCamera } from '../../src/client/canvas/useCamera';
import { BoardViewport, CameraContext } from '../../src/client/canvas/BoardViewport';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../../src/client/board/Marquee';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { getObjectType } from '../../src/client/objects/registry';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { Size } from '../../src/client/canvas/camera';

const SIZE: Size = { width: 1280, height: 800 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Minimal undo test harness with full board wiring. */
function UndoHarness(props: {
  doc: Y.Doc;
  canEdit?: boolean;
}) {
  const { doc, canEdit = true } = props;
  const api = useCamera(SIZE);
  const [objects, setObjects] = useState<readonly ObjectSnapshot[]>(() => snapshot(doc));

  useEffect(() => {
    const objectsMap = doc.getMap('objects');
    const handler = () => setObjects(snapshot(doc));
    objectsMap.observeDeep(handler);
    return () => objectsMap.unobserveDeep(handler);
  }, [doc]);

  const selection = useSelection(objects);
  const undoRef = useRef<UndoController | null>(null);
  useEffect(() => {
    undoRef.current = createUndo(doc);
    return () => { undoRef.current?.destroy(); undoRef.current = null; };
  }, [doc]);
  const undoController = undoRef.current;
  const undoApi = useUndo(undoController, canEdit);
  const boundary = () => { undoRef.current?.boundary(); };

  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });
  const marquee = useMarquee(api.camera, objects, (ids) => selection.setMany(ids, true));
  useBoardKeys({ doc, selection, snapshot: objects, canEdit, tool: 'select', setTool: () => {}, onCreateSticky: () => {}, onBoundary: boundary, onUndo: undoApi.undo, onRedo: undoApi.redo });

  const handleDblClickEmpty = (pt: { x: number; y: number }) => {
    const world = screenToWorld(api.camera, pt);
    boundary();
    const id = createSticky(doc, world);
    boundary();
    if (id) selection.startEdit(id);
  };

  const handleDeleteSelection = () => {
    if (selection.ids.size === 0) return;
    boundary();
    deleteObjects(doc, [...selection.ids]);
    boundary();
    selection.clear();
  };

  const handleObjectDoubleClick = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    if (obj && getObjectType(obj.type)?.editableText) selection.startEdit(id);
  };

  return (
    <CameraContext.Provider value={api}>
      <div>
        <BoardViewport onDblClickEmpty={handleDblClickEmpty} onClickEmpty={() => selection.clear()} marquee={marquee}>
          {objects.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={obj.id}
                obj={obj}
                doc={doc}
                zoom={api.camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={selection.editingId === obj.id}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onObjectDoubleClick={handleObjectDoubleClick}
                onEndEdit={selection.endEdit}
                onBoundary={boundary}
                onUndo={undoApi.undo}
                onRedo={undoApi.redo}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} />
        </BoardViewport>
        <SelectionOverlay ids={selection.ids} snapshot={objects} camera={api.camera} onHandlePointerDown={gesture.onHandlePointerDown} />
        {/* Test outputs */}
        <div data-testid="selected" data-value={[...selection.ids].sort().join(',')} />
        <div data-testid="editing" data-value={selection.editingId ?? ''} />
        <div data-testid="note-count" data-value={String(objects.length)} />
        <div data-testid="can-undo" data-value={String(undoApi.canUndo)} />
        <div data-testid="can-redo" data-value={String(undoApi.canRedo)} />
        <UndoButtons
          canUndo={undoApi.canUndo}
          canRedo={undoApi.canRedo}
          undo={undoApi.undo}
          redo={undoApi.redo}
        />
        <button data-testid="delete-btn" onClick={handleDeleteSelection}>Delete</button>
      </div>
    </CameraContext.Provider>
  );
}

describe('undo component tests (TC-14 to TC-21)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  afterEach(() => {
    cleanup();
  });

  // TC-14: one drag, undo → note back at start position, one step.
  it('TC-14 one drag is one undo step', () => {
    // Pre-create the note so the undo history starts with just the move.
    const objects = doc.getMap('objects');
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', new Y.Text());
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    }, LOCAL_ORIGIN);

    render(<UndoHarness doc={doc} />);

    // Move the note (this is the gesture we want to undo).
    act(() => {
      moveObjects(doc, new Map([[id, { x: 200, y: 200 }]]));
    });

    // The undo button should be enabled.
    expect(screen.getByTestId('can-undo')).toHaveAttribute('data-value', 'true');

    // Click undo.
    fireEvent.click(screen.getByTestId('undo-btn'));

    // The note should be back at its original position.
    const snap = snapshot(doc);
    expect(snap.length).toBe(1);
    expect(snap[0].x).toBe(100);
    expect(snap[0].y).toBe(100);
  });

  // TC-15: multi-segment text editing, undo → note text back to original,
  // one step.
  it('TC-15 multi-segment text editing is one undo step', () => {
    const text = new Y.Text();
    const objects = doc.getMap('objects');
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', text);
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    }, LOCAL_ORIGIN);

    render(<UndoHarness doc={doc} />);

    // Simulate typing in segments (the text editor would do boundary() on mount/end,
    // but the captures within are merged by the capture timeout).
    const ctrl = createUndo(doc);
    ctrl.boundary(); // Close the creation step.
    
    // Type in two segments (within capture timeout → one step).
    doc.transact(() => { text.insert(0, 'hello'); }, LOCAL_ORIGIN);
    doc.transact(() => { text.insert(5, ' world'); }, LOCAL_ORIGIN);
    ctrl.boundary(); // Close the typing step.

    // One undo should remove all the typed text.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('');

    ctrl.destroy();
  });

  // TC-16: rapid create, undo → one step (boundary() on gesture end, not per
  // pointer event).
  it('TC-16 rapid create is one undo step', () => {
    render(<UndoHarness doc={doc} />);

    // Create two notes rapidly (simulating a rapid gesture).
    act(() => {
      const ctrl = createUndo(doc);
      ctrl.boundary();
      createSticky(doc, { x: 100, y: 100 });
      createSticky(doc, { x: 200, y: 100 });
      ctrl.boundary();
      
      // One undo should remove both.
      expect(ctrl.canUndo()).toBe(true);
      ctrl.undo();
      expect(snapshot(doc).length).toBe(0);
      ctrl.destroy();
    });
  });

  // TC-17: typing after a pause, two undos.
  it('TC-17 typing after a pause produces two undo steps', () => {
    const text = new Y.Text();
    const objects = doc.getMap('objects');
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', text);
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    }, LOCAL_ORIGIN);

    render(<UndoHarness doc={doc} />);

    const ctrl = createUndo(doc);
    ctrl.boundary(); // Close the creation step.

    // First typing segment.
    doc.transact(() => { text.insert(0, 'a'); }, LOCAL_ORIGIN);
    // boundary() simulates the pause (stopCapturing resets the timer).
    ctrl.boundary();
    // Second typing segment.
    doc.transact(() => { text.insert(1, 'b'); }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Two undos needed.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('a');
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('');

    ctrl.destroy();
  });

  // TC-18: Ctrl+Z / Ctrl+Shift+Z work in editor and board.
  it('TC-18 keyboard shortcuts undo and redo', () => {
    render(<UndoHarness doc={doc} />);

    // Create a note (triggers a boundary in the harness).
    act(() => {
      createSticky(doc, { x: 100, y: 100 });
    });

    // Press Ctrl+Z to undo.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });

    // The note should be gone.
    expect(screen.getByTestId('note-count')).toHaveAttribute('data-value', '0');

    // Press Ctrl+Shift+Z to redo.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    });

    // The note should be back.
    expect(screen.getByTestId('note-count')).toHaveAttribute('data-value', '1');
  });

  // TC-19: Undo/Redo buttons: enabled/disabled, tooltip, aria-label.
  it('TC-19 undo/redo buttons have correct aria-labels and states', () => {
    render(<UndoHarness doc={doc} />);

    const undoBtn = screen.getByTestId('undo-btn');
    const redoBtn = screen.getByTestId('redo-btn');

    // Aria labels.
    expect(undoBtn).toHaveAttribute('aria-label', 'Undo');
    expect(redoBtn).toHaveAttribute('aria-label', 'Redo');

    // Tooltips.
    expect(undoBtn).toHaveAttribute('title', 'Undo (Ctrl/Cmd+Z)');
    expect(redoBtn).toHaveAttribute('title', 'Redo (Ctrl/Cmd+Shift+Z)');

    // Initially disabled (no history).
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    // After a change, undo is enabled.
    act(() => {
      createSticky(doc, { x: 100, y: 100 });
    });
    expect(undoBtn).not.toBeDisabled();

    // After undo, redo is enabled.
    fireEvent.click(undoBtn);
    expect(redoBtn).not.toBeDisabled();
  });

  // TC-20: undo/redo disabled in edit-locked board.
  it('TC-20 undo/redo disabled when editing is locked', () => {
    render(<UndoHarness doc={doc} canEdit={false} />);

    const undoBtn = screen.getByTestId('undo-btn');
    const redoBtn = screen.getByTestId('redo-btn');

    // Even with history, buttons are disabled when canEdit is false.
    act(() => {
      createSticky(doc, { x: 100, y: 100 });
    });

    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
  });

  // TC-21: undo/redo do not fire while the text editor has focus
  // (the board-level handler is inert when editingId is set).
  it('TC-21 board shortcuts inert while text editor is open', () => {
    render(<UndoHarness doc={doc} />);

    // Create a note.
    act(() => {
      createSticky(doc, { x: 100, y: 100 });
    });

    // Simulate a textarea being the event target (as when the text editor is focused).
    // The board keys handler checks if target is TEXTAREA and returns early.
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    
    // Dispatch a keydown event with the textarea as target.
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
    act(() => {
      textarea.dispatchEvent(event);
    });
    
    // The note should still be there (undo was not applied because target is TEXTAREA).
    expect(screen.getByTestId('note-count')).toHaveAttribute('data-value', '1');
    
    document.body.removeChild(textarea);
  });
});
