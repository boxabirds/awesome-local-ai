import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  createSticky as createStickyRaw,
  moveObjects,
  setStickyColor,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { useState } from 'react';

function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: Parameters<typeof createStickyRaw>[2]): string {
  const id = createStickyRaw(doc, at, color);
  if (!id) throw new Error('createSticky failed');
  return id;
}

/**
 * TC-14 to TC-17: Component tests for undo step boundaries.
 * Uses a real Y.Doc, real controller, and the story 7 gesture hook in jsdom.
 */

// ---- Test harness components -----------------------------------------------

function EditorHarness({ doc, controller, noteId }: { doc: Y.Doc; controller: UndoController; noteId: string }) {
  const ytext = (doc.getMap('objects').get(noteId) as Y.Map<unknown>)?.get('text') as Y.Text;
  const [editing, setEditing] = useState(true);

  if (!editing || !ytext) return null;

  return (
    <StickyTextEditor
      ytext={ytext}
      fontPx={14}
      onEnd={() => setEditing(false)}
      boundary={() => controller.boundary()}
      undoController={controller}
    />
  );
}

// ---- Tests -------------------------------------------------------------------

describe('undo.boundaries: component tests (TC-14 to TC-17)', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { captureTimeoutMs: 500 });
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  // TC-14: 30-frame drag of a selection → one undo restores every object's start position
  it('TC-14: multi-frame drag is one undo step', () => {
    // Create 3 stickies
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = createSticky(doc, { x: i * 300, y: 100 });
      ids.push(id);
    }
    controller.boundary();

    const beforeSnap = snapshot(doc);

    // Simulate a 30-frame drag: multiple moveObjects calls within one capture window
    for (let frame = 1; frame <= 30; frame++) {
      const positions = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const orig = beforeSnap.find((n) => n.id === id)!;
        positions.set(id, { x: orig.x + frame * 10, y: orig.y + frame * 5 });
      }
      moveObjects(doc, positions);
    }

    // Call boundary() to end the gesture
    controller.boundary();

    // Should be exactly one undo step for the entire drag
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    // All objects should be back to their start positions
    const afterSnap = snapshot(doc);
    for (const id of ids) {
      const before = beforeSnap.find((n) => n.id === id)!;
      const after = afterSnap.find((n) => n.id === id)!;
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
    }
  });

  // TC-15: drag ends, colour changed 200 ms later → two separate steps
  it('TC-15: gesture end boundary separates from subsequent change', () => {
    const id = createSticky(doc, { x: 100, y: 100 }, 'yellow');
    controller.boundary();

    const beforePos = snapshot(doc).find((n) => n.id === id)!;

    // Simulate a drag (multiple frames)
    for (let i = 1; i <= 5; i++) {
      moveObjects(doc, new Map([[id, { x: beforePos.x + i * 10, y: beforePos.y }]]));
    }
    // Gesture end: boundary()
    controller.boundary();

    // Now change colour (a separate action)
    controller.boundary();
    setStickyColor(doc, id, 'blue');
    controller.boundary();

    // Should be two separate undo steps (drag + colour)
    expect(controller.canUndo()).toBe(true);

    // Undo the colour change
    controller.undo();
    let snap = snapshot(doc);
    let note = snap.find((n) => n.id === id)!;
    expect(note.color).toBe('yellow');
    // Position should still be at the drag end position
    expect(note.x).toBe(beforePos.x + 50);

    // Undo the drag
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    snap = snapshot(doc);
    note = snap.find((n) => n.id === id)!;
    expect(note.x).toBe(beforePos.x);
  });

  // TC-16: edit a note, type "hello", Ctrl+Z inside the editor → typing undone; earlier move not undone
  it('TC-16: Ctrl+Z inside editor undoes typing, not earlier actions', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    // Move the note (earlier action)
    const beforePos = snapshot(doc).find((n) => n.id === id)!;
    moveObjects(doc, new Map([[id, { x: beforePos.x + 50, y: beforePos.y }]]));
    controller.boundary();

    // Render the editor
    render(
      <EditorHarness doc={doc} controller={controller} noteId={id} />
    );

    const textarea = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;

    // Type "hello"
    act(() => {
      textarea.value = 'h';
      fireEvent.input(textarea);
    });
    act(() => {
      textarea.value = 'he';
      fireEvent.input(textarea);
    });
    act(() => {
      textarea.value = 'hel';
      fireEvent.input(textarea);
    });
    act(() => {
      textarea.value = 'hell';
      fireEvent.input(textarea);
    });
    act(() => {
      textarea.value = 'hello';
      fireEvent.input(textarea);
    });

    // Press Ctrl+Z inside the editor
    act(() => {
      fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    });

    // The typing should be undone
    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
    expect(ytext.toString()).toBe('');

    // The earlier move should NOT be undone
    const snap = snapshot(doc);
    const note = snap.find((n) => n.id === id)!;
    expect(note.x).toBe(beforePos.x + 50);
  });

  // TC-17: pointercancel mid-drag → one step restoring the start position
  it('TC-17: cancelled drag is still one undo step', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const beforePos = snapshot(doc).find((n) => n.id === id)!;

    // Simulate a partial drag
    for (let i = 1; i <= 10; i++) {
      moveObjects(doc, new Map([[id, { x: beforePos.x + i * 5, y: beforePos.y }]]));
    }

    // Pointercancel: boundary() is called
    controller.boundary();

    // Should be one undo step
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    // Object should be back to start position
    const snap = snapshot(doc);
    const note = snap.find((n) => n.id === id)!;
    expect(note.x).toBe(beforePos.x);
    expect(note.y).toBe(beforePos.y);
  });
});
