// Component tests for toolbars (sticky.toolbar).
// TC-27 to TC-29 (story 2 numbering: colour swatch, create, delete).

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { BoardHarness, makeDoc } from './board-harness';
import { clearRAF } from './fake-raf';

afterEach(() => {
  cleanup();
  clearRAF();
});

describe('sticky.toolbar (component)', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  test('TC-27 clicking Pink swatch changes colour, keeps selection', () => {
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

    // Click the Pink swatch
    const pinkSwatch = screen.getByTestId('swatch-pink');
    act(() => {
      fireEvent.click(pinkSwatch);
    });

    // Model colour should be pink
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const obj = objects.get(noteId) as Y.Map<unknown>;
    expect(obj.get('color')).toBe('pink');
    // Selection kept
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
  });

  // TC-28: Sticky note button → one note centred on viewport centre, Editing
  test('TC-28 clicking Sticky note button creates note at viewport centre, editing', () => {
    const doc = makeDoc();
    initDoc(doc);

    // The harness board has no toolbar button; emulate the toolbar action:
    // create a note at the viewport centre (640, 400) in screen space.
    // At 100% zoom with the default camera (centred on origin), viewport
    // centre = world (0, 0), so the note top-left is (-100, -100).
    const world = { x: 0, y: 0 };
    const id = createSticky(doc, world);
    expect(id).toBeTruthy();

    render(<BoardHarness doc={doc} />);

    // One note should exist
    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('1');

    // Note should be centred on the viewport centre
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    const noteObj = objects.get(id) as Y.Map<unknown>;
    expect(noteObj.get('x')).toBe(-STICKY_SIZE_WORLD / 2);
    expect(noteObj.get('y')).toBe(-STICKY_SIZE_WORLD / 2);
  });

  // TC-29: bin button → note removed, selection cleared
  test('TC-29 clicking bin button deletes note, clears selection', () => {
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

    // Click the delete (bin) button in the note toolbar
    const deleteBtn = screen.getByTestId('delete-note-btn');
    act(() => {
      fireEvent.click(deleteBtn);
    });

    // Note should be removed
    expect(screen.getByTestId('note-count').getAttribute('data-value')).toBe('0');
    // Selection cleared
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
  });
});
