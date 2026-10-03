// Component tests for sticky note interaction (sticky.interaction).
// TC-18 to TC-22, TC-25, TC-35 to TC-37.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  initDoc,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { BoardHarness, makeDoc } from './board-harness';
import { flushRAF, clearRAF } from './fake-raf';

afterEach(() => {
  cleanup();
  clearRAF();
});

describe('sticky.interaction (component)', () => {
  // TC-18: press+release without move → Selected, outline and NoteToolbar shown
  test('TC-18 pointerdown+up without move selects the note', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);

    const note = screen.getByTestId('sticky-note');
    expect(note).toBeTruthy();

    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });

    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(note).toHaveAttribute('data-selected');
  });

  // TC-19: move 2px (< DRAG_THRESHOLD_PX) → still Selected, no moveObject
  test('TC-19 move 2px (below threshold) does not move the note', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const initialX = 200 - STICKY_SIZE_WORLD / 2;
    const initialY = 200 - STICKY_SIZE_WORLD / 2;

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(note, { clientX: 302, clientY: 300, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 302, clientY: 300, button: 0, pointerId: 1 });
    });
    flushRAF();

    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(noteId) as Y.Map<unknown>;
    expect(obj.get('x')).toBe(initialX);
    expect(obj.get('y')).toBe(initialY);
  });

  // TC-20: move 3px (= threshold) → Dragging; board camera unchanged (no pan)
  test('TC-20 move 3px (at threshold) starts drag; board does not pan', () => {
    const doc = makeDoc();
    initDoc(doc);
    createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');
    const camXBefore = screen.getByTestId('camera-x').getAttribute('data-value');
    const camYBefore = screen.getByTestId('camera-y').getAttribute('data-value');

    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(note, { clientX: 303, clientY: 300, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 303, clientY: 300, button: 0, pointerId: 1 });
    });
    flushRAF();

    expect(screen.getByTestId('camera-x').getAttribute('data-value')).toBe(camXBefore);
    expect(screen.getByTestId('camera-y').getAttribute('data-value')).toBe(camYBefore);
  });

  // TC-21: pointercancel during drag → Selected at last position
  test('TC-21 pointercancel during drag keeps last position', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const initialX = 200 - STICKY_SIZE_WORLD / 2;

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(note, { clientX: 310, clientY: 300, pointerId: 1 });
      fireEvent.pointerCancel(note, { clientX: 310, clientY: 300, pointerId: 1 });
    });
    flushRAF();

    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(noteId) as Y.Map<unknown>;
    expect(obj.get('x')).toBe(initialX + 10);
  });

  // TC-22: click empty board → Unselected, toolbar gone
  test('TC-22 click empty board clears selection', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select the note
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    // Click on the viewport (empty space)
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      fireEvent.click(viewport);
    });

    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-25: Delete and Backspace on selected → removed
  test('TC-25a Delete key removes selected note', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);

    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });

    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
  });

  test('TC-25b Backspace key removes selected note', () => {
    const doc = makeDoc();
    initDoc(doc);
    createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Backspace' });
    });

    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
  });

  // TC-35: dblclick on existing note → no new note, edits existing
  test('TC-35 dblclick on existing note edits it, does not create new', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    act(() => {
      fireEvent.doubleClick(note);
    });

    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);
    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('1');
  });

  // TC-36: Enter with nothing selected → nothing happens
  test('TC-36 Enter with nothing selected does nothing', () => {
    const doc = makeDoc();
    initDoc(doc);

    render(<BoardHarness doc={doc} />);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe('');
    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
  });

  // TC-37: note deleted while Dragging or Editing → interaction ends, no exception
  test('TC-37a note deleted while dragging ends interaction silently', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Start a drag
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(note, { clientX: 310, clientY: 300, pointerId: 1 });
    });
    flushRAF();

    // Delete the note mid-drag
    act(() => {
      deleteObject(doc, noteId);
    });

    // Complete the drag - should not throw
    act(() => {
      fireEvent.pointerUp(note, { clientX: 310, clientY: 300, button: 0, pointerId: 1 });
    });
    flushRAF();

    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
  });

  test('TC-37b note deleted while editing ends interaction silently', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Start editing
    act(() => {
      fireEvent.doubleClick(note);
    });
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);

    // Delete the note while editing
    act(() => {
      deleteObject(doc, noteId);
    });

    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
  });
});
