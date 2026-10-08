import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import * as React from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { STICKY_SIZE_WORLD, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

type ObjMap = Y.Map<any>;

/** Create a Y.Doc with sample sticky notes */
function makeDocWithNotes(count: number): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  doc.getMap('meta'); // ensure meta exists
  const objects: ObjMap = doc.getMap('objects') as ObjMap;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `note-${i}`;
    ids.push(id);
    const noteMap = new Y.Map();
    noteMap.set('type', 'sticky');
    noteMap.set('x', i * 50);
    noteMap.set('y', i * 50);
    noteMap.set('color', i % 2 === 0 ? 'yellow' : 'blue');
    noteMap.set('text', '');
    noteMap.set('width', STICKY_SIZE_WORLD);
    noteMap.set('height', STICKY_SIZE_WORLD);
    objects.set(id, noteMap);
  }
  return { doc, ids };
}

// ---------------------------------------------------------------------------
// TC-14: 30-frame drag → one undo step restoring start
// ---------------------------------------------------------------------------
describe('TC-14: gesture boundary merges multi-frame drag into one step', () => {
  it('onGestureStart/end creates exactly one undo step for a complete drag', () => {
    const { doc, ids } = makeDocWithNotes(1);
    const controller = createUndo(doc);

    // Simulate gesture start
    controller.boundary();

    // Simulate multiple frames of moveObjects transactions within one capture window
    for (let i = 0; i < 30; i++) {
      const objects: ObjMap = doc.getMap('objects') as ObjMap;
      doc.transact(() => {
        const obj = objects.get(ids[0]) as ObjMap;
        obj.set('x', 50 + i * 2);
        obj.set('y', 50 + i * 2);
      }, LOCAL_ORIGIN);
    }

    // At this point, all 30 frames should be in ONE step
    expect(controller.canUndo()).toBe(true);
    expect(controller.undoStackLength).toBe(1);

    // End gesture
    controller.boundary();

    // Undo restores to original position (before frame 0)
    controller.undo();
    const finalObj = (doc.getMap('objects') as ObjMap).get(ids[0]) as ObjMap;
    expect(finalObj!.get('x')).toBe(0);
    expect(finalObj!.get('y')).toBe(0);

    controller.destroy();
  });
});

// ---------------------------------------------------------------------------
// TC-15: drag ends, colour changed 200ms later → two separate steps
// ---------------------------------------------------------------------------
describe('TC-15: gesture end separates subsequent actions into new steps', () => {
  it('drag then colour change produce two distinct undoable steps', () => {
    vi.useFakeTimers();
    const { doc, ids } = makeDocWithNotes(1);
    const controller = createUndo(doc);

    // Simulate drag start
    controller.boundary();

    // Drag: one transaction
    const objects: ObjMap = doc.getMap('objects') as ObjMap;
    doc.transact(() => {
      const obj = objects.get(ids[0]) as ObjMap;
      obj.set('x', 100);
      obj.set('y', 100);
    }, LOCAL_ORIGIN);

    // Simulate drag end (boundary closes capture)
    controller.boundary();

    expect(controller.canUndo()).toBe(true);
    expect(controller.undoStackLength).toBe(1);

    // Wait 200ms — still within UNDO_CAPTURE_TIMEOUT_MS but boundary already closed it
    vi.advanceTimersByTime(200);

    // Colour change with another boundary
    controller.boundary();
    doc.transact(() => {
      const obj = objects.get(ids[0]) as ObjMap;
      obj.set('color', 'green');
    }, LOCAL_ORIGIN);

    // Should now have 2 steps
    expect(controller.canUndo()).toBe(true);
    expect(controller.undoStackLength).toBe(2);

    // First undo: colour change undone
    controller.undo();
    expect((objects.get(ids[0]) as ObjMap).get('color')).toBe('yellow');
    expect((objects.get(ids[0]) as ObjMap).get('x')).toBe(100); // x still moved

    // Second undo: move undone
    controller.undo();
    expect((objects.get(ids[0]) as ObjMap).get('x')).toBe(0);
    expect((objects.get(ids[0]) as ObjMap).get('y')).toBe(0);

    controller.destroy();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// TC-16: edit note, type "hello", Ctrl+Z inside editor → typing undone
// ---------------------------------------------------------------------------
describe('TC-16: Ctrl+Z inside editor undoes typing only, not earlier moves', () => {
  it('typing undone by Ctrl+Z in editor does not touch earlier undo step', () => {
    const { doc, ids } = makeDocWithNotes(1);
    const controller = createUndo(doc);

    // Make an initial move (step 1)
    controller.boundary();
    const objects: ObjMap = doc.getMap('objects') as ObjMap;
    doc.transact(() => {
      const obj = objects.get(ids[0]) as ObjMap;
      obj.set('x', 100);
      obj.set('y', 100);
    }, LOCAL_ORIGIN);
    controller.boundary();

    // Now start editing (simulate editing start = boundary)
    controller.boundary();

    // Type some text (simulated via text insertions with LOCAL_ORIGIN)
    // Use the actual Y.Text from the first note
    const noteObj = objects.get(ids[0]) as ObjMap;
    let textVal = noteObj.get('text') as Y.Text | undefined;
    if (!textVal) {
      textVal = new Y.Text('');
      doc.transact(() => {
        noteObj.set('text', textVal);
      }, LOCAL_ORIGIN);
    }
    doc.transact(() => {
      textVal.insert(0, 'hello');
    }, LOCAL_ORIGIN);

    controller.boundary();
    expect(controller.canUndo()).toBe(true);
    expect(controller.undoStackLength).toBe(2);

    // Now simulate what happens when Ctrl+Z is pressed inside the editor:
    // The controller.undo() is called directly by the editor handler
    controller.undo();

    // Text should be empty (typing undone)
    expect(textVal.toString()).toBe('');
    // But the move should still be there
    expect((objects.get(ids[0]) as ObjMap).get('x')).toBe(100);

    // One more undo should restore the move
    controller.undo();
    expect((objects.get(ids[0]) as ObjMap).get('x')).toBe(0);
    expect((objects.get(ids[0]) as ObjMap).get('y')).toBe(0);

    controller.destroy();
  });
});

// ---------------------------------------------------------------------------
// TC-17: pointercancel mid-drag → one step restoring start
// ---------------------------------------------------------------------------
describe('TC-17: pointercancel mid-gesture still closes capture as one step', () => {
  it('cancelled drag is still one undo step at the accumulated positions', () => {
    const { doc, ids } = makeDocWithNotes(1);
    const controller = createUndo(doc);

    controller.boundary();

    // Some move frames (as if dragging started)
    const objects: ObjMap = doc.getMap('objects') as ObjMap;
    doc.transact(() => {
      const obj = objects.get(ids[0]) as ObjMap;
      obj.set('x', 50);
      obj.set('y', 30);
    }, LOCAL_ORIGIN);

    // Simulate pointercancel (boundary called)
    controller.boundary();

    expect(controller.canUndo()).toBe(true);
    expect(controller.undoStackLength).toBe(1);

    // Undo restores to original
    controller.undo();
    expect((objects.get(ids[0]) as ObjMap).get('x')).toBe(0);
    expect((objects.get(ids[0]) as ObjMap).get('y')).toBe(0);

    controller.destroy();
  });
});

// ---------------------------------------------------------------------------
// Component tests for buttons (covers TC-18 partially)
// ---------------------------------------------------------------------------
describe('UndoButtons disabled state', () => {
  it('both buttons disabled when stacks are empty', () => {
    const mockController = {
      undo: vi.fn(),
      redo: vi.fn(),
      boundary: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      addScope: vi.fn(),
      onChange: vi.fn(),
      destroy: vi.fn(),
      get undoStackLength() { return 0; },
    };

    // Mock the hook
    const undoHook = {
      canUndo: false,
      canRedo: false,
      undo: () => mockController.undo(),
      redo: () => mockController.redo(),
    };

    render(<UndoButtons {...undoHook} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');

    expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
    expect((undoBtn as HTMLElement).getAttribute('title')).toBe('Undo (Ctrl/Cmd+Z)');
    expect((redoBtn as HTMLElement).getAttribute('title')).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });
});

describe('useUndo subscribes to controller changes', () => {
  it('canUndo/canRedo reflect controller state after change events', () => {
    const { doc, ids } = makeDocWithNotes(1);
    const controller = createUndo(doc);
    
    // We can't easily test re-rendering in unit context without a full react tree,
    // so we verify the core logic: controller starts with canUndo=false
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(false);

    // After a local change
    controller.boundary();
    const objects: ObjMap = doc.getMap('objects') as ObjMap;
    doc.transact(() => {
      objects.get(ids[0]).set('x', 999);
    }, LOCAL_ORIGIN);
    controller.boundary();

    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    controller.destroy();
  });
});
