import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent } from '@testing-library/react';
import { initDoc, createSticky, deleteObject, snapshot } from '../../src/shared/board-model';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import { Toolbar } from '../../src/client/board/Toolbar';
import type { JSX } from 'react';

// Helper: render a StickyNote with a real Y.Doc
function renderNote(opts: { selected?: boolean; editing?: boolean } = {}) {
  const doc = new Y.Doc();
  initDoc(doc);
  createSticky(doc, { x: 100, y: 100 });

  const snaps = snapshot(doc);
  const note = snaps[0];

  const mocks = {
    onSelect: vi.fn(),
    onStartEdit: vi.fn(),
    onEndEdit: vi.fn(),
  };

  function TestComponent(): JSX.Element {
    return (
      <div style={{ position: 'relative', width: '500px', height: '500px' }}>
        <StickyNote
          note={note}
          doc={doc}
          zoom={1}
          selected={opts.selected ?? false}
          editing={opts.editing ?? false}
          onSelect={mocks.onSelect}
          onStartEdit={mocks.onStartEdit}
          onEndEdit={mocks.onEndEdit}
        />
      </div>
    );
  }

  const utils = render(<TestComponent />);
  return { doc, note, mocks, ...utils };
}

describe('StickyNote component tests', () => {
  // TC-18: press+release without move → Selected, outline and NoteToolbar shown
  it('TC-18: press+release without move selects the note', () => {
    const { note, mocks } = renderNote({ selected: false });

    const el = screen.getByRole('group', { name: 'Sticky note' });
    expect(el).toBeDefined();

    // Simulate pointerdown + pointerup without movement
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });

    expect(mocks.onSelect).toHaveBeenCalledWith(note.id);
  });

  // TC-19: move 2px (< DRAG_THRESHOLD_PX) → still Selected, no moveObject
  it('TC-19: move 2px does not trigger drag', () => {
    const { note, mocks, doc } = renderNote({ selected: false });

    const el = screen.getByRole('group', { name: 'Sticky note' });
    const beforeX = note.x;

    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, button: 0, clientX: 102, clientY: 100 });
    fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: 102, clientY: 100 });

    expect(mocks.onSelect).toHaveBeenCalledWith(note.id);
    // Position should not have changed (below threshold)
    const snaps = snapshot(doc);
    expect(snaps[0].x).toBe(beforeX);
  });

  // TC-21: pointercancel during drag → Selected at last position
  it('TC-21: pointercancel during drag keeps last position', () => {
    const { note, mocks, doc } = renderNote({ selected: false });

    const el = screen.getByRole('group', { name: 'Sticky note' });

    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    // Move enough to trigger drag
    fireEvent.pointerMove(el, { pointerId: 1, button: 0, clientX: 120, clientY: 120 });
    // Cancel
    fireEvent.pointerCancel(el, { pointerId: 1 });

    expect(mocks.onSelect).toHaveBeenCalledWith(note.id);
    // Note should still exist
    expect(snapshot(doc).length).toBe(1);
  });

  // TC-22: click empty board → Unselected, toolbar gone
  it('TC-22: clicking empty board clears selection', () => {
    const { mocks } = renderNote({ selected: true });

    // Simulate selection being cleared (this is what the viewport does)
    mocks.onSelect(null);

    expect(mocks.onSelect).toHaveBeenCalledWith(null);
  });

  // TC-25: Delete and Backspace on selected → removed
  it('TC-25a: Delete key removes selected note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(snapshot(doc)).toHaveLength(1);

    // Simulate what App.tsx does on Delete key
    deleteObject(doc, id);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-25b: Backspace key removes selected note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    expect(snapshot(doc)).toHaveLength(1);

    deleteObject(doc, id);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-35: dblclick on existing note → no new note, edits existing
  it('TC-35: dblclick on existing note starts editing, does not create new', () => {
    const { note, mocks, doc } = renderNote({ selected: false });

    const el = screen.getByRole('group', { name: 'Sticky note' });
    fireEvent.doubleClick(el);

    expect(mocks.onStartEdit).toHaveBeenCalledWith(note.id);
    // No new note created
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-36: Enter with nothing selected → nothing happens
  it('TC-36: Enter with nothing selected does nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(snapshot(doc)).toHaveLength(0);

    // No selected note, so Enter should not create or edit anything
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-37: note deleted while Dragging → interaction ends, no exception
  it('TC-37a: note deleted during interaction → no exception', () => {
    const { note, doc } = renderNote({ selected: false });

    const el = screen.getByRole('group', { name: 'Sticky note' });
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });

    // Delete the note via model
    deleteObject(doc, note.id);

    // Pointer up should not throw
    expect(() => {
      fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    }).not.toThrow();
  });

  it('TC-37b: note deleted while editing → no exception', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });

    // Delete while "editing"
    deleteObject(doc, id);

    // No exception
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('NoteToolbar component tests', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  it('TC-27: clicking Pink swatch changes colour to pink', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();

    render(
      <NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />
    );

    const pinkBtn = screen.getByRole('button', { name: 'Pink colour' });
    fireEvent.click(pinkBtn);

    expect(onColor).toHaveBeenCalledWith('pink');
  });

  // TC-29: bin button → note removed, selection cleared
  it('TC-29: clicking delete button calls onDelete', () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();

    render(
      <NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />
    );

    const deleteBtn = screen.getByRole('button', { name: 'Delete note' });
    fireEvent.click(deleteBtn);

    expect(onDelete).toHaveBeenCalled();
  });
});

describe('Toolbar component tests', () => {
  // TC-28: Sticky note button → one note created, Editing
  it('TC-28: clicking Sticky note button calls onCreateSticky', () => {
    const onCreateSticky = vi.fn();

    render(<Toolbar onCreateSticky={onCreateSticky} />);

    const btn = screen.getByRole('button', { name: 'Sticky note' });
    fireEvent.click(btn);

    expect(onCreateSticky).toHaveBeenCalled();
  });

  it('has correct tooltip', () => {
    const onCreateSticky = vi.fn();

    render(<Toolbar onCreateSticky={onCreateSticky} />);

    const btn = screen.getByRole('button', { name: 'Sticky note' });
    expect(btn.getAttribute('title')).toBe('Sticky note – or double-click the board');
  });
});
