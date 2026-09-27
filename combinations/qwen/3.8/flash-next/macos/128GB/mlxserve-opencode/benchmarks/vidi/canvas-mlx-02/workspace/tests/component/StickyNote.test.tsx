import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  renderBoard,
  createViaToolbar,
  escape,
  clickEmpty,
  pressNote,
  notePos,
  hasOutline,
} from './stickyTestUtils.tsx';
import { StickyNote } from '../../src/client/objects/StickyNote.tsx';
import {
  initDoc,
  createSticky,
  deleteObject,
  snapshot,
} from '../../src/shared/board-model.ts';

describe('sticky note interaction (sticky.interaction)', () => {
  // TC-18: press + release with no movement selects; outline and toolbar appear.
  it('TC-18 selects a note on a short press', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    clickEmpty(h); // deselect first
    expect(h.note(0).getAttribute('data-selected')).toBe('false');

    pressNote(h, 0);
    const el = h.note(0);
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(h.view.queryByTestId('note-toolbar')).toBeTruthy();
    expect(hasOutline(el)).toBe(true);
  });

  // TC-19: a 2px move (below DRAG_THRESHOLD_PX) selects but never moves the note.
  it('TC-19 ignores a move below the drag threshold', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    clickEmpty(h);
    const before = notePos(h.note(0));

    const el = h.note(0);
    fireEvent.pointerDown(el, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 402, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 402, clientY: 300, pointerId: 1 });

    const after = notePos(el);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(el.getAttribute('data-selected')).toBe('true');
  });

  // TC-20: a 3px move (= threshold) drags the note without panning the board.
  it('TC-20 drags at the threshold without panning the camera', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    clickEmpty(h);
    const camBefore = h.cam();
    const before = notePos(h.note(0));

    const el = h.note(0);
    fireEvent.pointerDown(el, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 403, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 403, clientY: 300, pointerId: 1 });

    // camera unchanged (stopPropagation prevented the pan)
    const camAfter = h.cam();
    expect(camAfter.x).toBeCloseTo(camBefore.x, 6);
    expect(camAfter.y).toBeCloseTo(camBefore.y, 6);
    // note moved right by the drag at zoom 1
    const after = notePos(el);
    expect(after.x).toBeCloseTo(before.x + 3, 1);
  });

  // TC-21: pointercancel during a drag keeps the note at its last shown position.
  it('TC-21 freezes the note at the last position on pointercancel', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    clickEmpty(h);
    const before = notePos(h.note(0));

    const el = h.note(0);
    fireEvent.pointerDown(el, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 460, clientY: 300, pointerId: 1 });
    fireEvent.pointerCancel(el, { pointerId: 1 });

    const after = notePos(el);
    expect(after.x).toBeCloseTo(before.x + 60, 1);
    expect(el.getAttribute('data-selected')).toBe('true');
  });

  // TC-22: clicking empty board space clears the selection and hides the toolbar.
  it('TC-22 clears the selection on an empty-space click', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    expect(h.note(0).getAttribute('data-selected')).toBe('true');

    clickEmpty(h);
    expect(h.note(0).getAttribute('data-selected')).toBe('false');
    expect(h.view.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-25: Delete removes a selected note (not editing).
  it('TC-25 deletes the selected note with Delete', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(h.notes()).toHaveLength(0);
  });

  // TC-25: Backspace removes a selected note (separate run).
  it('TC-25 deletes the selected note with Backspace', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(h.notes()).toHaveLength(0);
  });

  // TC-35 (negative): double-clicking a note edits it and creates no new note.
  it('TC-35 edits an existing note on double-click without creating one', () => {
    const h = renderBoard();
    createViaToolbar(h);
    escape(h);
    const before = h.notes().length;

    fireEvent.doubleClick(h.note(0), { clientX: 500, clientY: 300 });
    expect(h.notes()).toHaveLength(before);
    expect(h.editor()).toBeTruthy();
  });

  // TC-36 (negative): Enter with nothing selected does nothing.
  it('TC-36 does nothing on Enter with nothing selected', () => {
    const h = renderBoard();
    expect(h.notes()).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(h.notes()).toHaveLength(0);
    expect(h.editor()).toBeNull();
  });
});

describe('sticky note stale id (error path)', () => {
  // TC-37: a note deleted mid-drag ends the interaction, throws nothing, is not
  // recreated.
  it('TC-37 ends a drag silently when the note is deleted mid-drag', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const props = {
      doc,
      zoom: 1,
      selected: true,
      editing: false,
      onSelect: vi.fn(),
      onStartEdit: vi.fn(),
      onEndEdit: vi.fn(),
      onColor: vi.fn(),
      onDelete: vi.fn(),
    };
    render(
      <div data-testid="world-layer" data-cam-x={0} data-cam-y={0} data-cam-zoom={1}>
        <StickyNote note={snapshot(doc)[0]} {...props} />
      </div>,
    );

    const el = screen.getByTestId(`sticky-${id}`);
    fireEvent.pointerDown(el, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 460, clientY: 300, pointerId: 1 }); // dragging
    deleteObject(doc, id); // vanish mid-drag (e.g. a remote delete)

    expect(() => {
      fireEvent.pointerMove(el, { clientX: 520, clientY: 300, pointerId: 1 });
      fireEvent.pointerUp(el, { clientX: 520, clientY: 300, pointerId: 1 });
    }).not.toThrow();

    expect(snapshot(doc)).toHaveLength(0); // not recreated
  });

  // TC-37: a note deleted while editing tears the editor down without a throw.
  it('TC-37 ends editing silently when the note is deleted while editing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const props = {
      doc,
      zoom: 1,
      selected: true,
      editing: true,
      onSelect: vi.fn(),
      onStartEdit: vi.fn(),
      onEndEdit: vi.fn(),
      onColor: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(
      <div data-testid="world-layer" data-cam-x={0} data-cam-y={0} data-cam-zoom={1}>
        <StickyNote note={snapshot(doc)[0]} {...props} />
      </div>,
    );
    expect(screen.queryByTestId('sticky-editor')).toBeTruthy();

    // A remote delete removes it; the snapshot-driven parent re-renders the note
    // away, ending editing without any write or throw.
    deleteObject(doc, id);
    expect(() => {
      rerender(
        <div data-testid="world-layer" data-cam-x={0} data-cam-y={0} data-cam-zoom={1}>
          {snapshot(doc).map((n) => (
            <StickyNote key={n.id} note={n} {...props} editing={false} />
          ))}
        </div>,
      );
    }).not.toThrow();

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
  });
});
