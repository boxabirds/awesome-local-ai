import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { initDoc, createSticky, snapshot, getStickyText } from '../../src/shared/board-model.ts';

function firePointer(el: Element, type: string, x: number, y: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  });
}
function fireKey(key: string, target: Element | Window = window) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    (target as Window).dispatchEvent(ev);
  });
  return ev;
}
function fireInput(ta: HTMLElement) {
  act(() => {
    ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
function type(ta: HTMLTextAreaElement, s: string) {
  act(() => {
    ta.value = ta.value + s;
  });
  fireInput(ta);
}

let doc: Y.Doc;
let id: string;

function setup(initialText = '') {
  doc = new Y.Doc();
  initDoc(doc);
  id = createSticky(doc, { x: 400, y: 300 });
  if (initialText) getStickyText(doc, id)!.insert(0, initialText);
  render(<BoardApp doc={doc} />);
}
function noteEl(): HTMLElement {
  return document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
}
function editor(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-text-editor') as HTMLTextAreaElement;
}
function text(): string {
  return snapshot(doc).find((n) => n.id === id)!.text;
}
function selectAndEdit() {
  firePointer(noteEl(), 'pointerdown', 150, 150);
  firePointer(noteEl(), 'pointerup', 150, 150);
  fireKey('Enter');
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.text (editor)', () => {
  it('TC-23 Enter on a selected note starts editing, textarea focused, caret at end', () => {
    setup('Hello');
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointerup', 150, 150);
    fireKey('Enter');
    const ta = editor();
    expect(ta.value).toBe('Hello');
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
  });

  it('TC-24 Escape ends editing, keeps the text and stays selected', () => {
    setup();
    selectAndEdit();
    type(editor(), 'abc');
    const ev = fireKey('Escape', editor());
    expect(ev.defaultPrevented).toBe(true);
    expect(text()).toBe('abc');
    expect(screen.queryByTestId('sticky-text-editor')).not.toBeInTheDocument();
    expect(noteEl().getAttribute('data-selected')).toBe('true');
  });

  it('TC-26 Backspace while editing edits text and never deletes the note', () => {
    setup('ab');
    selectAndEdit();
    const ev = fireKey('Backspace', editor());
    expect(ev.defaultPrevented).toBe(false); // BoardApp must not intercept while editing
    // Emulate the browser removing the character before the caret.
    const ta = editor();
    act(() => {
      ta.value = 'a';
    });
    fireInput(ta);
    expect(snapshot(doc)).toHaveLength(1); // note still present
    expect(text()).toBe('a');
  });

  it('TC-38 typing then clicking outside commits text and unselects', () => {
    setup();
    selectAndEdit();
    type(editor(), 'abc');
    const vp = screen.getByTestId('viewport');
    firePointer(vp, 'pointerdown', 30, 30);
    firePointer(vp, 'pointerup', 30, 30);
    expect(screen.queryByTestId('sticky-text-editor')).not.toBeInTheDocument();
    expect(text()).toBe('abc');
    expect(noteEl().getAttribute('data-selected')).toBe('false');
  });
});
