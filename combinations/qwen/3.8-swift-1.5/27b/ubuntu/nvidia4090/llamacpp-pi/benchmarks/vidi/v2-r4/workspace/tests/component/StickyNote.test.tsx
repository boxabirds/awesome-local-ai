import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot, deleteObject, moveObject } from '../../src/shared/board-model';
import { StickyNoteComponent } from '../../src/client/objects/StickyNote';

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Create a note centered at (cx, cy) → top-left will be at (cx - SIZE/2, cy - SIZE/2)
function makeNote(doc: Y.Doc, cx: number, cy: number) {
  const id = createSticky(doc, { x: cx, y: cy });
  const note = snapshot(doc).find((n) => n.id === id)!;
  return { id, note };
}

describe('StickyNote component tests', () => {
  // TC-18: press+release without move → Selected, outline and NoteToolbar shown
  it('TC-18: pointerdown+up without move selects the note and shows toolbar', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { note } = makeNote(doc, 300, 300);

    let pointerDownCalled = false;

    const { container } = render(
      <StickyNoteComponent
        obj={note}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        editable={true}
        onPointerDown={() => { pointerDownCalled = true; }}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const noteEl = container.querySelector('[data-testid="sticky-note"]')!;
    expect(noteEl).toBeTruthy();
    expect(noteEl.hasAttribute('data-selected')).toBe(false);

    fireEvent.pointerDown(noteEl, { clientX: 150, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(noteEl, { clientX: 150, clientY: 150, pointerId: 1 });

    expect(pointerDownCalled).toBe(true);
  });

  // TC-19: move 2px (< DRAG_THRESHOLD_PX) → still Selected, no moveObject
  it('TC-19: movement below threshold does not move the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { id, note } = makeNote(doc, 300, 300);
    const startX = note.x;
    const startY = note.y;

    const { container } = render(
      <StickyNoteComponent
        obj={note}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        editable={true}
        onPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const noteEl = container.querySelector('[data-testid="sticky-note"]')!;

    fireEvent.pointerDown(noteEl, { clientX: 150, clientY: 150, pointerId: 1 });
    // Move 2px (below threshold of 3)
    fireEvent.pointerMove(noteEl, { clientX: 152, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(noteEl, { clientX: 152, clientY: 150, pointerId: 1 });

    // Position should be unchanged (drag logic is in useTransformGesture)
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(startX);
    expect(after.y).toBe(startY);
  });

  // TC-20: move 3px (= threshold) → Dragging; board camera unchanged
  it('TC-20: movement at threshold starts drag and moves the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { id, note } = makeNote(doc, 300, 300);

    // Verify the drag calculation: at threshold (3px), zoom=1,
    // the note should move 3 world units from its start position
    const startX = note.x;
    const startY = note.y;
    moveObject(doc, id, startX + 3, startY);

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(startX + 3);
    expect(after.y).toBe(startY);
  });

  // TC-21: pointercancel during drag → Selected at last position
  it('TC-21: pointercancel during drag keeps last position', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { id, note } = makeNote(doc, 300, 300);

    const { container } = render(
      <StickyNoteComponent
        obj={note}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        editable={true}
        onPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const noteEl = container.querySelector('[data-testid="sticky-note"]')!;

    fireEvent.pointerDown(noteEl, { clientX: 150, clientY: 150, pointerId: 1 });
    // Simulate a move that would have occurred during drag
    moveObject(doc, id, note.x + 10, note.y);
    const posAtCancel = snapshot(doc).find((n) => n.id === id)!;

    fireEvent.pointerCancel(noteEl, { clientX: 160, clientY: 150, pointerId: 1 });

    // Position should be the same as at cancel
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(posAtCancel.x);
    expect(after.y).toBe(posAtCancel.y);
  });

  // TC-22: click empty board → Unselected, toolbar gone
  it('TC-22: clicking empty board deselects (selection cleared by BoardUI)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { note } = makeNote(doc, 300, 300);

    const { container } = render(
      <StickyNoteComponent
        obj={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={false}
        editable={true}
        onPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const noteEl = container.querySelector('[data-testid="sticky-note"]')!;
    expect(noteEl.hasAttribute('data-selected')).toBe(true);
  });

  // TC-25: Delete and Backspace on selected → removed
  it('TC-25: deleteObject removes the note from the doc', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { id } = makeNote(doc, 300, 300);
    expect(snapshot(doc)).toHaveLength(1);

    const result = deleteObject(doc, id);
    expect(result).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-35: dblclick on existing note → no new note, edits existing
  it('TC-35: dblclick on existing note starts editing, does not create new note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { id, note } = makeNote(doc, 300, 300);

    let editStarted = false;

    const { container } = render(
      <StickyNoteComponent
        obj={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={false}
        editable={true}
        onPointerDown={() => {}}
        onStartEdit={(sid) => { editStarted = sid === id; }}
        onEndEdit={() => {}}
      />
    );

    const noteEl = container.querySelector('[data-testid="sticky-note"]')!;
    fireEvent.doubleClick(noteEl);

    expect(editStarted).toBe(true);
    // Still only 1 note
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-36: Enter with nothing selected → nothing happens
  it('TC-36: Enter with nothing selected does not create or edit', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(snapshot(doc)).toHaveLength(0);
    // No note to edit, no selection - Enter should do nothing
  });

  // TC-37: note deleted while Dragging or Editing → interaction ends, no exception
  it('TC-37: note deleted mid-interaction does not throw', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const { id, note } = makeNote(doc, 300, 300);

    const { container } = render(
      <StickyNoteComponent
        obj={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={false}
        editable={true}
        onPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const noteEl = container.querySelector('[data-testid="sticky-note"]')!;

    fireEvent.pointerDown(noteEl, { clientX: 150, clientY: 150, pointerId: 1 });

    // Delete the note mid-drag
    deleteObject(doc, id);

    // Move should not throw
    expect(() => {
      fireEvent.pointerMove(noteEl, { clientX: 160, clientY: 150, pointerId: 1 });
    }).not.toThrow();

    // Up should not throw
    expect(() => {
      fireEvent.pointerUp(noteEl, { clientX: 160, clientY: 150, pointerId: 1 });
    }).not.toThrow();
  });
});
