// Component tests for sticky text editing (sticky.text).
// TC-23, TC-24, TC-26, TC-38.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createSticky,
  getStickyText,
  initDoc,
} from '../../src/shared/board-model';
import { BoardHarness, makeDoc } from './board-harness';
import { clearRAF } from './fake-raf';

afterEach(() => {
  cleanup();
  clearRAF();
});

describe('sticky.text (component)', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  test('TC-23 Enter on selected note starts editing with caret at end', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });
    // Set some text
    const ytext = getStickyText(doc, noteId)!;
    ytext.insert(0, 'hello');

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select the note
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });

    // Press Enter to start editing
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    // Should be editing
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);

    // Textarea should be present and focused
    const textarea = screen.getByLabelText('Sticky note text');
    expect(textarea).toBeTruthy();
    expect(textarea).toHaveFocus();
    // Caret at end
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(5);
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(5);
  });

  // TC-24: Escape → Selected, text preserved
  test('TC-24 Escape ends editing, text preserved', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const ytext = getStickyText(doc, noteId)!;
    ytext.insert(0, 'hello world');

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select and start editing
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);

    // Press Escape
    const textarea = screen.getByLabelText('Sticky note text');
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });

    // Should be selected (not editing)
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe('');
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
    // Text preserved
    expect(ytext.toString()).toBe('hello world');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  test('TC-26 Backspace while editing deletes character, not note', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const ytext = getStickyText(doc, noteId)!;
    ytext.insert(0, 'ab');

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select and start editing
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    // Press Backspace in the textarea (should delete 'b', not the note)
    const textarea = screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'a';
      fireEvent.input(textarea);
    });

    // Note should still be present
    expect(screen.getByTestId('sticky-note')).toBeTruthy();
    // Text should be 'a'
    expect(ytext.toString()).toBe('a');
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  test('TC-38 type text then click outside: editor unmounts, text saved, unselected', () => {
    const doc = makeDoc();
    initDoc(doc);
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const ytext = getStickyText(doc, noteId)!;

    render(<BoardHarness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Start editing via double-click
    act(() => {
      fireEvent.doubleClick(note);
    });
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);

    // Type 'abc'
    const textarea = screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'abc';
      fireEvent.input(textarea);
    });

    // Text should be in Y.Text
    expect(ytext.toString()).toBe('abc');

    // Click outside (on the viewport): pointerdown ends editing, the
    // trailing click clears the selection.
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
      fireEvent.pointerUp(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
      fireEvent.click(viewport);
    });

    // Editor should be unmounted
    expect(screen.queryByLabelText('Sticky note text')).toBeNull();
    // Should be unselected
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe('');
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
    // Text preserved
    expect(ytext.toString()).toBe('abc');
  });
});
