/**
 * Component tests for the sticky note object component (story 2 rendering,
 * story 7 delegation).
 *
 * The component renders the note at its persisted size and delegates pointer
 * interaction to the generic transform gesture; selection outlines, the
 * bounding box and the toolbar are board-level (SelectionOverlay/SelectionBar).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  initDoc,
  createSticky,
  objects,
  resizeObjects,
  deleteObject,
} from '../../src/shared/board-model';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

function makeDocWithNote(x = 100, y = 100): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x, y });
  return { doc, id };
}

function renderNote(
  doc: Y.Doc,
  id: string,
  opts: { selected?: boolean; editing?: boolean } = {},
) {
  const obj = objects(doc).find((o) => o.id === id)!;
  const onObjectPointerDown = vi.fn();
  const onStartEdit = vi.fn();
  const onEndEdit = vi.fn();

  const utils = render(
    <StickyNote
      obj={obj}
      doc={doc}
      zoom={1}
      selected={opts.selected ?? false}
      editing={opts.editing ?? false}
      onObjectPointerDown={onObjectPointerDown}
      onStartEdit={onStartEdit}
      onEndEdit={onEndEdit}
    />,
  );

  return { ...utils, obj, onObjectPointerDown, onStartEdit, onEndEdit };
}

describe('sticky object component (story 7 delegation)', () => {
  let doc: Y.Doc;
  let noteId: string;

  beforeEach(() => {
    const setup = makeDocWithNote();
    doc = setup.doc;
    noteId = setup.id;
  });

  // Renders at STICKY_SIZE_WORLD until a resize writes width/height.
  it('renders at STICKY_SIZE_WORLD without explicit width/height', () => {
    renderNote(doc, noteId);
    const el = screen.getByTestId('sticky-note');
    expect(el).toHaveStyle({ width: `${STICKY_SIZE_WORLD}px`, height: `${STICKY_SIZE_WORLD}px` });
  });

  it('renders at its persisted width/height after a resize', () => {
    resizeObjects(doc, new Map([[noteId, { x: -100, y: -100, width: 120, height: 90 }]]));
    renderNote(doc, noteId);
    const el = screen.getByTestId('sticky-note');
    expect(el).toHaveStyle({ width: '120px', height: '90px' });
  });

  // pointerdown delegates to the generic gesture (no component-local drag).
  it('pointerdown delegates to onObjectPointerDown', () => {
    const { onObjectPointerDown } = renderNote(doc, noteId);
    const el = screen.getByTestId('sticky-note');

    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });

    expect(onObjectPointerDown).toHaveBeenCalledTimes(1);
    expect(onObjectPointerDown.mock.calls[0][1]).toBe(noteId);
  });

  it('right-click does not start a gesture', () => {
    const { onObjectPointerDown } = renderNote(doc, noteId);
    const el = screen.getByTestId('sticky-note');

    fireEvent.pointerDown(el, { button: 2, pointerId: 1, clientX: 100, clientY: 100 });

    expect(onObjectPointerDown).not.toHaveBeenCalled();
  });

  it('no gesture while editing', () => {
    const { onObjectPointerDown } = renderNote(doc, noteId, { editing: true });
    const el = screen.getByTestId('sticky-note');

    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });

    expect(onObjectPointerDown).not.toHaveBeenCalled();
  });

  // dblclick starts editing the existing note (no new note created).
  it('dblclick starts editing, does not create a new note', () => {
    const { onStartEdit } = renderNote(doc, noteId);
    const el = screen.getByTestId('sticky-note');

    fireEvent.doubleClick(el);

    expect(onStartEdit).toHaveBeenCalledWith(noteId);
    expect(objects(doc)).toHaveLength(1);
  });

  // data-selected attribute for the outline hook.
  it('exposes data-selected only when selected', () => {
    const { unmount } = renderNote(doc, noteId, { selected: true });
    expect(screen.getByTestId('sticky-note').hasAttribute('data-selected')).toBe(true);
    unmount();

    renderNote(doc, noteId, { selected: false });
    expect(screen.getByTestId('sticky-note').hasAttribute('data-selected')).toBe(false);
  });

  // The toolbar no longer lives inside the component (it is the SelectionBar).
  it('does not render an internal toolbar', () => {
    renderNote(doc, noteId, { selected: true });
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // A note deleted mid-interaction: ending edit does not throw.
  it('onEndEdit after remote deletion does not throw', () => {
    const { onEndEdit } = renderNote(doc, noteId, { editing: true });
    deleteObject(doc, noteId);
    expect(() => onEndEdit('selected')).not.toThrow();
  });
});
