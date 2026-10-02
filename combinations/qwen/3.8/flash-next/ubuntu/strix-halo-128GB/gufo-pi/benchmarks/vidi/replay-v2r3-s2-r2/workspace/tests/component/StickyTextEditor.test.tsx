import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { StickyHarness } from './StickyHarness';
import { createSticky, getStickyText } from '../../src/shared/board-model';

function harness() {
  const h = window.__harness;
  if (!h) throw new Error('harness not ready');
  return h;
}

function firstNote(): HTMLElement {
  const n = screen.getAllByTestId('sticky-note')[0];
  return n as HTMLElement;
}

function textarea(): HTMLTextAreaElement {
  const el = screen.getByTestId('sticky-textarea');
  return el as HTMLTextAreaElement;
}

/** Create a note with initial text and start editing it. */
function createAndEdit(initial: string): string {
  let id = '';
  act(() => {
    id = createSticky(harness().doc, { x: 300, y: 200 });
    if (initial) getStickyText(harness().doc, id)!.insert(0, initial);
  });
  act(() => harness().select(id));
  fireEvent.keyDown(window, { key: 'Enter' });
  return id;
}

beforeEach(() => {
  window.__harness = undefined;
});
afterEach(() => cleanup());

describe('sticky.text editor', () => {
  it('TC-23: Enter on a selected note starts editing with the caret at the end', () => {
    render(<StickyHarness />);
    createAndEdit('hello');
    const ta = textarea();
    expect(ta).toBeTruthy();
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe('hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
  });

  it('TC-24: Escape ends editing as selected and preserves the text', () => {
    render(<StickyHarness />);
    const id = createAndEdit('keep me');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(firstNote().getAttribute('data-selected')).toBe('true');
    expect(getStickyText(harness().doc, id)!.toString()).toBe('keep me');
  });

  it('TC-26: Backspace while editing edits text and does not delete the note', () => {
    render(<StickyHarness />);
    const id = createAndEdit('ab');
    const ta = textarea();
    ta.value = 'ab';
    ta.setSelectionRange(2, 2);
    fireEvent.keyDown(ta, { key: 'Backspace' });
    // Emulate the browser's own deletion of the character before the caret.
    ta.value = 'a';
    fireEvent.input(ta);
    expect(screen.getAllByTestId('sticky-note')).toHaveLength(1);
    expect(getStickyText(harness().doc, id)!.toString()).toBe('a');
  });

  it('TC-38: typing then clicking outside unmounts the editor, keeps text, deselects', () => {
    render(<StickyHarness />);
    const id = createAndEdit('');
    const ta = textarea();
    ta.value = 'abc';
    fireEvent.input(ta);

    const g = document.querySelector('[data-grid-layer="true"]') as HTMLElement;
    fireEvent.pointerDown(g, { clientX: 5, clientY: 5, pointerId: 1 });

    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(getStickyText(harness().doc, id)!.toString()).toBe('abc');
    expect(firstNote().getAttribute('data-selected')).toBe('false');
    expect(harness().getSelectedId()).toBeNull();
  });
});
