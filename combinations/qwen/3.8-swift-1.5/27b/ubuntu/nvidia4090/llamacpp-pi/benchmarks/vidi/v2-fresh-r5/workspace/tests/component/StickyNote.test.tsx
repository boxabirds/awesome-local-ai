import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, deleteObject, snapshot } from '../../src/shared/board-model';
import { StickyNote } from '../../src/client/objects/StickyNote';

// Helper to render a StickyNote with a real Y.Doc
function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 100, y: 100 });
  const notes = snapshot(doc);
  const obj = notes[0];

  const onPointerDownMock = vi.fn();
  const onDoubleClickMock = vi.fn();
  const onEndEditMock = vi.fn();

  const utils = {
    doc,
    id,
    obj,
    onPointerDownMock,
    onDoubleClickMock,
    onEndEditMock,
    render: (overrides: {
      selected?: boolean;
      editing?: boolean;
      canEdit?: boolean;
    } = {}) => {
      return render(
        <StickyNote
          obj={obj}
          doc={doc}
          canEdit={overrides.canEdit ?? true}
          selected={overrides.selected ?? false}
          editing={overrides.editing ?? false}
          onPointerDown={onPointerDownMock}
          onDoubleClick={onDoubleClickMock}
          onEndEdit={onEndEditMock}
        />
      );
    },
  };
  return utils;
}

describe('StickyNote rendering', () => {
  it('renders with role=group and aria-label="Sticky note"', () => {
    const { render: renderNote } = setup();
    renderNote();
    const note = screen.getByRole('group', { name: 'Sticky note' });
    expect(note).toBeInTheDocument();
  });

  it('shows data-selected when selected', () => {
    const { render: renderNote } = setup();
    renderNote({ selected: true });
    const note = screen.getByTestId('sticky-note');
    expect(note).toHaveAttribute('data-selected');
  });

  it('does not show data-selected when not selected', () => {
    const { render: renderNote } = setup();
    renderNote({ selected: false });
    const note = screen.getByTestId('sticky-note');
    expect(note).not.toHaveAttribute('data-selected');
  });

  it('delegates pointerdown to onPointerDown prop', () => {
    const { render: renderNote, id, onPointerDownMock } = setup();
    renderNote();

    const note = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(note, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(onPointerDownMock).toHaveBeenCalledWith(expect.anything(), id);
  });

  it('does not delegate pointerdown when not canEdit', () => {
    const { render: renderNote, onPointerDownMock } = setup();
    renderNote({ canEdit: false });

    const note = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(note, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(onPointerDownMock).not.toHaveBeenCalled();
  });

  it('delegates doubleClick to onDoubleClick prop', () => {
    const { render: renderNote, id, onDoubleClickMock } = setup();
    renderNote();

    const note = screen.getByTestId('sticky-note');
    fireEvent.doubleClick(note);
    expect(onDoubleClickMock).toHaveBeenCalledWith(id);
  });

  it('note deleted while interacting → no exception', () => {
    const { render: renderNote, id, doc } = setup();
    renderNote({ selected: false });

    const note = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(note, { pointerId: 1, clientX: 100, clientY: 100 });

    // Delete the note mid-interaction
    act(() => {
      deleteObject(doc, id);
    });

    // Should not throw
    expect(snapshot(doc)).toHaveLength(0);
  });
});
