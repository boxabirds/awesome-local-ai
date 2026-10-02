import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import { snapshot, deleteObject } from '../../src/shared/board-model';
import { renderApp, createNote, setNoteText } from './renderApp';
import { createPointerEvent } from './helpers';

function dispatchPointer(el: HTMLElement, type: string, props: { clientX?: number; clientY?: number; pointerId?: number; button?: number }) {
  act(() => {
    el.dispatchEvent(createPointerEvent(type, props));
  });
}

function selectNote(note: HTMLElement) {
  // Press + release without movement → Selected
  dispatchPointer(note, 'pointerdown', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
  dispatchPointer(note, 'pointerup', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
}

function dblclickNote(note: HTMLElement) {
  act(() => {
    note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

function keyOnWindow(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('sticky.interaction (StickyNote)', () => {
  it('TC-18 press+release without move → Selected; outline and NoteToolbar rendered', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    expect(note).not.toHaveAttribute('data-selected');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    selectNote(note);

    expect(note).toHaveAttribute('data-selected');
    expect(note.style.outline).toContain('#1a73e8');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    // Selection is not stored in the doc
    expect(snapshot(doc).find((n) => n.id === id)).toBeDefined();
  });

  it('TC-19 move 2px (< DRAG_THRESHOLD_PX) → Selected, note not moved (boundary)', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    const before = snapshot(doc).find((n) => n.id === id)!;

    dispatchPointer(note, 'pointerdown', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
    dispatchPointer(note, 'pointermove', { clientX: 642, clientY: 400, pointerId: 1, button: 0 });
    dispatchPointer(note, 'pointerup', { clientX: 642, clientY: 400, pointerId: 1, button: 0 });

    expect(note).toHaveAttribute('data-selected');
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('TC-20 move 3px (= threshold) → Dragging (toolbar hidden), board camera unchanged (no pan)', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    const worldLayer = screen.getByTestId('world-layer');
    const transformBefore = worldLayer.style.transform;
    const before = snapshot(doc).find((n) => n.id === id)!;

    dispatchPointer(note, 'pointerdown', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
    dispatchPointer(note, 'pointermove', { clientX: 643, clientY: 400, pointerId: 1, button: 0 });

    // Dragging: toolbar hidden
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    dispatchPointer(note, 'pointerup', { clientX: 643, clientY: 400, pointerId: 1, button: 0 });

    // Board camera did not move (no pan)
    expect(worldLayer.style.transform).toBe(transformBefore);
    // The note moved by 3 world units (3px / zoom 1)
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(before.x + 3);
    expect(after.y).toBe(before.y);
    // Selected after the drag
    expect(note).toHaveAttribute('data-selected');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('TC-21 pointercancel during drag → Selected at last position', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    const before = snapshot(doc).find((n) => n.id === id)!;

    dispatchPointer(note, 'pointerdown', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
    dispatchPointer(note, 'pointermove', { clientX: 650, clientY: 400, pointerId: 1, button: 0 });
    dispatchPointer(note, 'pointercancel', { clientX: 650, clientY: 400, pointerId: 1, button: 0 });

    expect(note).toHaveAttribute('data-selected');
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(before.x + 10);
    expect(after.y).toBe(before.y);
  });

  it('TC-22 click empty board → Unselected, toolbar gone', () => {
    const { doc } = renderApp();
    createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);
    expect(note).toHaveAttribute('data-selected');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    const viewport = screen.getByTestId('board-viewport');
    dispatchPointer(viewport, 'pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    dispatchPointer(viewport, 'pointerup', { clientX: 100, clientY: 100, pointerId: 1, button: 0 });

    expect(note).not.toHaveAttribute('data-selected');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25a Delete key on selected note → removed', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);

    keyOnWindow('Delete');

    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();
  });

  it('TC-25b Backspace key on selected note → removed', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);

    keyOnWindow('Backspace');

    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();
  });

  it('TC-35 dblclick on an existing note → no new note, existing note edited (negative)', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    setNoteText(doc, id, 'existing');
    const note = screen.getByRole('group', { name: 'Sticky note' });

    dblclickNote(note);

    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    expect((screen.getByTestId('sticky-textarea') as HTMLTextAreaElement).value).toBe('existing');
  });

  it('TC-36 Enter with nothing selected → nothing happens (negative)', () => {
    const { doc } = renderApp();
    keyOnWindow('Enter');
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
  });

  it('TC-37a note deleted via model while Dragging → interaction ends silently, no exception, note not recreated', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });

    dispatchPointer(note, 'pointerdown', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
    dispatchPointer(note, 'pointermove', { clientX: 660, clientY: 400, pointerId: 1, button: 0 });
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // dragging

    act(() => {
      deleteObject(doc, id);
    });

    // pointerup on the (now detached) element must not throw
    expect(() => {
      dispatchPointer(note, 'pointerup', { clientX: 660, clientY: 400, pointerId: 1, button: 0 });
    }).not.toThrow();

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
  });

  it('TC-37b note deleted via model while Editing → editor unmounted, no exception, note not recreated', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });

    dblclickNote(note);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();

    act(() => {
      deleteObject(doc, id);
    });

    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
  });
});
