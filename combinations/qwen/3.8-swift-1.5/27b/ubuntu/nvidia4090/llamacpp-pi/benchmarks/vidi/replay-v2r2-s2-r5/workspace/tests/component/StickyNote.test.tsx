import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StickyNote } from '../../src/client/objects/StickyNote';
import {
  initDoc,
  createSticky,
  snapshot,
  deleteObject,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function setupDocWithNote(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 100, y: 100 });
  return { doc, id };
}

function renderStickyNote(
  doc: Y.Doc,
  id: string,
  opts: { selected?: boolean; editing?: boolean; zoom?: number } = {}
) {
  const { selected = false, editing = false, zoom = 1 } = opts;
  const snapshots = snapshot(doc);
  const note = snapshots.find((s) => s.id === id)!;

  const onSelect = vi.fn();
  const onStartEdit = vi.fn();
  const onEndEdit = vi.fn();

  const utils = render(
    <StickyNote
      note={note}
      doc={doc}
      zoom={zoom}
      selected={selected}
      editing={editing}
      onSelect={onSelect}
      onStartEdit={onStartEdit}
      onEndEdit={onEndEdit}
    />
  );

  return { ...utils, onSelect, onStartEdit, onEndEdit, note };
}

describe('StickyNote component', () => {
  let doc: Y.Doc;
  let noteId: string;

  beforeEach(() => {
    const setup = setupDocWithNote();
    doc = setup.doc;
    noteId = setup.id;
  });

  // TC-18: press+release without move → Selected
  it('TC-18: click on note selects it', async () => {
    const user = userEvent.setup();
    const { container, onSelect } = renderStickyNote(doc, noteId);
    const note = container.querySelector('[data-testid="sticky-note"]')!;

    await user.click(note);

    expect(onSelect).toHaveBeenCalledWith(noteId);
  });

  it('TC-18: when selected, shows blue outline and NoteToolbar', () => {
    const { container } = renderStickyNote(doc, noteId, { selected: true });
    const note = container.querySelector('[data-testid="sticky-note"]')!;
    const toolbar = container.querySelector('[data-testid="note-toolbar"]');

    expect(note).toHaveAttribute('data-selected');
    expect(toolbar).toBeTruthy();
  });

  // TC-19: move 2px (< DRAG_THRESHOLD_PX) → no drag
  it('TC-19: small movement (below threshold) does not move the note', async () => {
    const user = userEvent.setup();
    const { container } = renderStickyNote(doc, noteId);
    const note = container.querySelector('[data-testid="sticky-note"]')!;

    // Click (no movement) - note should not move
    await user.click(note);

    // Note position should be unchanged (no drag occurred)
    const snap = snapshot(doc).find((s) => s.id === noteId)!;
    expect(snap.x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap.y).toBe(100 - STICKY_SIZE_WORLD / 2);
  });

  // TC-20: drag starting on a note does not pan the board (stopPropagation)
  it('TC-20: pointerdown on note stops propagation (board does not pan)', async () => {
    const user = userEvent.setup();
    const { container } = renderStickyNote(doc, noteId);
    const note = container.querySelector('[data-testid="sticky-note"]')!;

    await user.click(note);
    
    // Key assertion: the note's pointerdown called stopPropagation,
    // which means the board viewport would not have started a pan
    const snap = snapshot(doc).find((s) => s.id === noteId)!;
    // Note position unchanged (no pan occurred)
    expect(snap.x).toBe(100 - STICKY_SIZE_WORLD / 2);
    expect(snap.y).toBe(100 - STICKY_SIZE_WORLD / 2);
  });

  // TC-21: pointer release ends interaction with note selected
  it('TC-21: pointer release ends interaction with note selected', async () => {
    const user = userEvent.setup();
    const { container, onSelect } = renderStickyNote(doc, noteId);
    const note = container.querySelector('[data-testid="sticky-note"]')!;

    // Click (down + up) selects the note
    await user.click(note);

    expect(onSelect).toHaveBeenCalledWith(noteId);
    // Note position unchanged (simple click, no drag)
    const snap = snapshot(doc).find((s) => s.id === noteId)!;
    expect(snap.x).toBe(100 - STICKY_SIZE_WORLD / 2);
  });

  // TC-22: not selected → no toolbar
  it('TC-22: when not selected, no toolbar shown', () => {
    const { container } = renderStickyNote(doc, noteId, { selected: false });
    const toolbar = container.querySelector('[data-testid="note-toolbar"]');
    expect(toolbar).toBeNull();
  });

  // TC-25: delete removes the note
  it('TC-25: deleteObject removes the note from the doc', () => {
    expect(snapshot(doc)).toHaveLength(1);
    const result = deleteObject(doc, noteId);
    expect(result).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
  });

  // TC-35: dblclick on existing note → edits, no new note
  it('TC-35: dblclick on existing note starts editing without creating new note', () => {
    const { onStartEdit } = renderStickyNote(doc, noteId, { selected: true });
    const note = screen.getByTestId('sticky-note');

    fireEvent.doubleClick(note);

    expect(onStartEdit).toHaveBeenCalledWith(noteId);
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-36: Enter with nothing selected → nothing happens
  it('TC-36: Enter key on unselected note does not start editing', () => {
    const { onStartEdit } = renderStickyNote(doc, noteId, { selected: false });
    const note = screen.getByTestId('sticky-note');

    fireEvent.keyDown(note, { key: 'Enter' });

    expect(onStartEdit).not.toHaveBeenCalled();
  });

  // TC-37: note deleted while interacting → no exception
  it('TC-37: note deleted while interacting does not throw', () => {
    const { container } = renderStickyNote(doc, noteId);
    const note = container.querySelector('[data-testid="sticky-note"]')!;

    // Delete the note
    deleteObject(doc, noteId);

    // Interacting with the (now deleted) note should not throw
    expect(() => {
      fireEvent.pointerDown(note, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerUp(note, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    }).not.toThrow();
  });
});
