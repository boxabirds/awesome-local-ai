import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { getStickyText } from '../../src/shared/board-model';
import { pointerEvent, fire, seed, boardState } from './harness';

function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}
function doc(): Y.Doc {
  return (window as unknown as { __vidi6: { doc: Y.Doc } }).__vidi6.doc;
}
function textarea(): HTMLTextAreaElement | null {
  return document.querySelector('textarea[data-testid="sticky-textarea"]');
}

beforeEach(() => {
  cleanup();
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});

describe('TC-23 Enter starts editing (caret at end)', () => {
  it('Enter on a selected note enters editing with the caret at the end', () => {
    render(<App />);
    const id = seed(640, 400);
    act(() => {
      getStickyText(doc(), id)!.insert(0, 'Hello');
    });
    const el = noteEl(id);
    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointerup', 640, 400));

    fire(window, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(boardState().editingId).toBe(id);
    const ta = textarea();
    expect(ta).not.toBeNull();
    expect(document.activeElement).toBe(ta);
    expect(ta!.value).toBe('Hello');
    expect(ta!.selectionStart).toBe(5);
    expect(ta!.selectionEnd).toBe(5);
  });
});

describe('TC-24 Escape ends editing and preserves text', () => {
  it('Escape leaves editing, keeps the note selected and keeps its text', () => {
    render(<App />);
    const id = seed(640, 400);
    act(() => {
      getStickyText(doc(), id)!.insert(0, 'keep me');
    });
    fire(noteEl(id), pointerEvent('dblclick', 640, 400));
    const ta = textarea();
    expect(ta).not.toBeNull();

    fire(ta!, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(boardState().editingId).toBeNull();
    expect(boardState().selectedId).toBe(id);
    expect(textarea()).toBeNull();
    expect(getStickyText(doc(), id)!.toString()).toBe('keep me');
  });
});

describe('TC-26 Backspace while editing edits text (does not delete the note)', () => {
  it('Backspace with "ab" keeps the note and yields "a"', () => {
    render(<App />);
    const id = seed(640, 400);
    act(() => {
      getStickyText(doc(), id)!.insert(0, 'ab');
    });
    fire(noteEl(id), pointerEvent('dblclick', 640, 400));
    const ta = textarea();
    expect(ta).not.toBeNull();

    // While editing, Backspace must not remove the note (App ignores it).
    fire(ta!, new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(document.querySelector(`[data-note-id="${id}"]`)).not.toBeNull();

    // Simulate the textarea's own deletion editing the text down to "a".
    act(() => {
      const el = textarea()!;
      el.value = 'a';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getStickyText(doc(), id)!.toString()).toBe('a');
  });
});

describe('TC-38 type then click outside', () => {
  it('typing "abc" then clicking outside unmounts the editor and keeps "abc"', () => {
    render(<App />);
    const id = seed(640, 400);
    fire(noteEl(id), pointerEvent('dblclick', 640, 400));

    act(() => {
      const el = textarea()!;
      el.value = 'abc';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getStickyText(doc(), id)!.toString()).toBe('abc');

    // Click empty board space to end editing.
    const vp = document.querySelector('[data-testid="board-viewport"]')!;
    fire(vp, pointerEvent('pointerdown', 100, 100));
    fire(vp, pointerEvent('pointerup', 100, 100));

    expect(textarea()).toBeNull();
    expect(boardState().selectedId).toBeNull();
    expect(getStickyText(doc(), id)!.toString()).toBe('abc');
  });
});