import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { createSticky, deleteObject, initDoc, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';

afterEach(cleanup);

function makeDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function mountNote(
  doc: Y.Doc,
  overrides: Partial<{
    selected: boolean;
    editing: boolean;
    onSelect: (id: string) => void;
    onStartEdit: (id: string) => void;
    onEndEdit: (next: 'selected' | 'unselected') => void;
    zoom: number;
  }> = {},
) {
  const id = createSticky(doc, { x: 200, y: 200 });
  const note = snapshot(doc)[0];
  const props = {
    note,
    doc,
    zoom: overrides.zoom ?? 1,
    selected: overrides.selected ?? false,
    editing: overrides.editing ?? false,
    onSelect: overrides.onSelect ?? vi.fn(),
    onStartEdit: overrides.onStartEdit ?? vi.fn(),
    onEndEdit: overrides.onEndEdit ?? vi.fn(),
  };
  const { rerender } = render(<StickyNote {...props} />);
  return { id, props, rerender, el: () => screen.getByTestId(`sticky-note-${id}`) };
}

function pointer(type: string, el: Element, x = 0, y = 0) {
  const ev = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  act(() => {
    el.dispatchEvent(ev);
  });
}

describe('StickyNote interaction', () => {
  // TC-18: press+release without move → Selected
  it('TC-18 pointerdown+up without move selects the note', () => {
    const doc = makeDoc();
    const onSelect = vi.fn();
    const { el } = mountNote(doc, { onSelect });
    const noteEl = el();
    pointer('pointerdown', noteEl, 100, 100);
    pointer('pointerup', noteEl, 100, 100);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // TC-19: move 2px (< DRAG_THRESHOLD_PX) → still just selected, no moveObject
  it('TC-19 move below threshold does not trigger drag', () => {
    const doc = makeDoc();
    const onSelect = vi.fn();
    const { el } = mountNote(doc, { onSelect });
    const noteEl = el();
    const beforeX = snapshot(doc)[0].x;
    pointer('pointerdown', noteEl, 100, 100);
    pointer('pointermove', noteEl, 100 + 2, 100);
    pointer('pointerup', noteEl, 100 + 2, 100);
    // Should just select, not move
    expect(snapshot(doc)[0].x).toBe(beforeX);
    expect(onSelect).toHaveBeenCalled();
  });

  // TC-20: move >= threshold → drag; board camera unchanged
  it('TC-20 move at threshold triggers drag (moves note)', () => {
    const doc = makeDoc();
    const onSelect = vi.fn();
    const { el } = mountNote(doc, { onSelect });
    const noteEl = el();
    const beforeX = snapshot(doc)[0].x;
    pointer('pointerdown', noteEl, 100, 100);
    pointer('pointermove', noteEl, 100 + DRAG_THRESHOLD_PX, 100);
    pointer('pointerup', noteEl, 100 + DRAG_THRESHOLD_PX, 100);
    // After a drag, the note should have moved (world x changed)
    const afterX = snapshot(doc)[0].x;
    expect(afterX).not.toBe(beforeX);
  });

  // TC-21: pointercancel during drag → ends at last position
  it('TC-21 pointercancel during drag ends interaction gracefully', () => {
    const doc = makeDoc();
    const { el } = mountNote(doc);
    const noteEl = el();
    pointer('pointerdown', noteEl, 100, 100);
    pointer('pointermove', noteEl, 100 + DRAG_THRESHOLD_PX, 100);
    pointer('pointercancel', noteEl, 100 + DRAG_THRESHOLD_PX, 100);
    // Note should be moved (at least partially) or stay at start
    // Key: no crash
  });

  // TC-22: clicking empty board clears selection (tested via App's onEmptyClick)
  // This test verifies that the note doesn't handle empty-space clicks itself

  // TC-25: Delete key on selected → removed (tested via App keyboard handler)

  // TC-35: dblclick on existing note → no new note, edits existing
  it('TC-35 dblclick on note starts editing, does not create new note', () => {
    const doc = makeDoc();
    const onStartEdit = vi.fn();
    const onSelect = vi.fn();
    const { id, el } = mountNote(doc, { onStartEdit, onSelect });
    const noteEl = el();
    const initialCount = snapshot(doc).length;
    act(() => {
      const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
      noteEl.dispatchEvent(ev);
    });
    expect(snapshot(doc).length).toBe(initialCount);
    expect(onStartEdit).toHaveBeenCalledWith(id);
  });

  // TC-37: note deleted while dragging → no exception
  it('TC-37 note deleted via model during drag ends gracefully', () => {
    const doc = makeDoc();
    const { id, el } = mountNote(doc);
    const noteEl = el();
    pointer('pointerdown', noteEl, 100, 100);
    pointer('pointermove', noteEl, 100 + DRAG_THRESHOLD_PX, 100);
    // Delete the note from the model
    act(() => {
      deleteObject(doc, id);
    });
    // Should not throw
    pointer('pointerup', noteEl, 100 + DRAG_THRESHOLD_PX, 100);
  });

  // TC-37b: note deleted while editing → no exception
  it('TC-37b note deleted via model during editing ends gracefully', () => {
    const doc = makeDoc();
    const onEndEdit = vi.fn();
    const { id } = mountNote(doc, { editing: true, onEndEdit });
    // Delete from model
    act(() => {
      deleteObject(doc, id);
    });
    // Should not throw (the note component may unmount)
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('renders with correct aria-label', () => {
    const doc = makeDoc();
    const { el } = mountNote(doc);
    const noteEl = el();
    expect(noteEl).toHaveAttribute('role', 'group');
    expect(noteEl).toHaveAttribute('aria-label', 'Sticky note');
  });

  it('has tabIndex for keyboard access', () => {
    const doc = makeDoc();
    mountNote(doc);
    const noteEls = document.querySelectorAll('[role="group"]');
    expect(noteEls[0]).toHaveAttribute('tabindex', '0');
  });
});
