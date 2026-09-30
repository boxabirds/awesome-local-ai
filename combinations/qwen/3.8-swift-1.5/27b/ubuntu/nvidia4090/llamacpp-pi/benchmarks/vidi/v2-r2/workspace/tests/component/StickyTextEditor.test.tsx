import { describe, it, expect } from 'vitest';
import { act, screen } from '@testing-library/react';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { renderApp, getNote } from './sticky-helpers';
import { createPointerEvent } from './helpers';

function selectAndEditNote(id: string, at = { x: 100, y: 100 }) {
  const el = getNote(id)!;
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerdown', { ...at, pointerId: 1, button: 0 }));
  });
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerup', { ...at, pointerId: 1, button: 0 }));
  });
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

describe('sticky.text (ui-component)', () => {
  it('TC-23: Enter on a selected note → Editing; textarea focused, caret at end', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
      getStickyText(doc, id)!.insert(0, 'Hello');
    });

    selectAndEditNote(id);

    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    expect(editor.value).toBe('Hello');
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(5);
    expect(editor.selectionEnd).toBe(5);
  });

  it('TC-24: Escape → Selected; text preserved', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
      getStickyText(doc, id)!.insert(0, 'Keep me');
    });

    selectAndEditNote(id);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('Keep me');
    expect(getNote(id)!.hasAttribute('data-selected')).toBe(true);
  });

  it("TC-26: Backspace while editing 'ab' → note present, text 'a' (negative: note not deleted)", () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
      getStickyText(doc, id)!.insert(0, 'ab');
    });

    selectAndEditNote(id);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;

    // The Backspace keydown reaches the window handler; it must be ignored
    // while editing (the key edits text, it does not delete the note).
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });
    // Simulate the textarea's default action: one character removed.
    act(() => {
      editor.value = 'a';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(getNote(id)).not.toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('a');
  });

  it("TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected", () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });

    selectAndEditNote(id);
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    act(() => {
      editor.value = 'abc';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getStickyText(doc, id)!.toString()).toBe('abc');

    // Click empty board space.
    const viewport = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointerdown', { clientX: 400, clientY: 300, pointerId: 1, button: 0 }));
    });
    act(() => {
      viewport.dispatchEvent(createPointerEvent('pointerup', { clientX: 400, clientY: 300, pointerId: 1, button: 0 }));
    });

    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('abc');
    expect(getNote(id)!.hasAttribute('data-selected')).toBe(false);
  });
});
