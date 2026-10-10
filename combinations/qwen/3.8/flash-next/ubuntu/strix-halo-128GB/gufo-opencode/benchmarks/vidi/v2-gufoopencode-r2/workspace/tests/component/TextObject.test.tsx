// Story 9 TC-19…TC-25: the free-text object — editing, delete-on-empty edit
// end, the TextToolbar size switch, horizontal-only handles, mixed-selection
// resize, remote deletion during edit, and the one-step edit undo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import type { TextSnapshot } from '../../src/shared/board-model';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import { getIdentity } from '../../src/client/identity/identity';
import {
  App,
  board,
  createNote,
  flush,
  keyDown,
  noteEl,
  pressAndRelease,
} from './stickyHelpers';
import { dragPath } from './selectionHelpers';

function textObjects(): TextSnapshot[] {
  return (board().getObjectSnapshots!() as TextSnapshot[]).filter((o) => o.type === 'text');
}

function createTextObj(x = 100, y = 100, content = ''): string {
  let id = '';
  act(() => {
    const created = createText(board().doc, { x, y }, getIdentity().id);
    if (created !== null) {
      id = created;
      if (content !== '') getTextContent(board().doc, created)?.insert(0, content);
    }
  });
  flush();
  if (id === '') throw new Error('createText failed');
  return id;
}

function textEl(id: string): HTMLElement {
  const el = screen
    .getAllByTestId('text-object')
    .find((n) => n.getAttribute('data-text-id') === id);
  if (!el) throw new Error(`text ${id} not rendered`);
  return el as HTMLElement;
}

function editor(): HTMLTextAreaElement {
  const el = screen.queryByTestId('text-editor');
  if (!el) throw new Error('text editor not mounted');
  return el as HTMLTextAreaElement;
}

function ctrlZ(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  });
  flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('text.object', () => {
  it('TC-19: Enter on selected text edits with caret at end; Enter inserts newline; Escape keeps text selected', () => {
    render(<App />);
    flush();
    const id = createTextObj(100, 100, 'hi');
    pressAndRelease(textEl(id));
    keyDown(window, 'Enter');
    flush();

    expect(document.activeElement).toBe(editor());
    expect(editor().value).toBe('hi');
    expect(editor().selectionStart).toBe(2);

    const enter = fireEvent.keyDown(editor(), { key: 'Enter' });
    expect(enter).toBe(true); // default not prevented: newline stays native
    fireEvent.input(editor(), { target: { value: 'hi\n' } });
    flush();
    expect(textObjects()[0].text).toBe('hi\n');

    fireEvent.keyDown(editor(), { key: 'Escape' });
    flush();
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(textEl(id).getAttribute('data-selected')).toBe('true');
    expect(textObjects()[0].text).toBe('hi\n');
  });

  it('TC-20: ending an edit with no characters removes the object and clears selection', () => {
    render(<App />);
    flush();
    const id = createTextObj(100, 100);
    pressAndRelease(textEl(id));
    keyDown(window, 'Enter');
    flush();
    expect(screen.queryByTestId('text-editor')).not.toBeNull();

    fireEvent.keyDown(editor(), { key: 'Escape' });
    flush();

    expect(textObjects()).toHaveLength(0);
    expect(screen.queryByTestId('text-object')).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('TC-21: TextToolbar shows S M L XL with M pressed; XL changes size, x/y unchanged', () => {
    render(<App />);
    flush();
    const id = createTextObj(100, 120, 'heading');
    pressAndRelease(textEl(id));

    expect(screen.getByTestId('text-size-S')).toBeInTheDocument();
    expect(screen.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-size-XL')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('text-size-XL'));
    flush();

    const t = textObjects()[0];
    expect(t.size).toBe('XL');
    expect(t.x).toBe(100);
    expect(t.y).toBe(120);
    expect(screen.getByTestId('text-size-XL')).toHaveAttribute('aria-pressed', 'true');
    expect(t.height).toBeGreaterThanOrEqual(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('TC-22: selecting one text shows only the e and w resize handles', () => {
    render(<App />);
    flush();
    const id = createTextObj(100, 100, 'hello');
    pressAndRelease(textEl(id));

    expect(screen.getByTestId('handle-e')).toBeInTheDocument();
    expect(screen.getByTestId('handle-w')).toBeInTheDocument();
    expect(screen.queryByTestId('handle-n')).toBeNull();
    expect(screen.queryByTestId('handle-s')).toBeNull();
    expect(screen.queryByTestId('handle-ne')).toBeNull();
    expect(screen.queryByTestId('handle-nw')).toBeNull();
    expect(screen.queryByTestId('handle-se')).toBeNull();
    expect(screen.queryByTestId('handle-sw')).toBeNull();
  });

  it('TC-23: text + sticky selection shows all handles; resize scales the box, font size unchanged', () => {
    render(<App />);
    flush();
    const id = createTextObj(100, 100, 'hello');
    const note = createNote(500, 100);
    pressAndRelease(textEl(id));
    fireEvent.pointerDown(noteEl(note), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    fireEvent.pointerUp(noteEl(note), { pointerId: 1, clientX: 10, clientY: 10, shiftKey: true });
    flush();

    expect(screen.getByTestId('handle-n')).toBeInTheDocument();
    expect(screen.getByTestId('handle-se')).toBeInTheDocument();

    const before = textObjects()[0];
    dragPath(screen.getByTestId('handle-e'), [
      [740, 440],
      [780, 440],
    ]);
    const after = textObjects()[0];
    expect(after.width).toBeGreaterThan(before.width ?? 0);
    expect(after.size).toBe(before.size); // proportional resize never resizes the font
    expect(after.x).toBe(before.x);
  });

  it('TC-24: remote delete during edit unmounts the editor with no error and no recreation', () => {
    render(<App />);
    flush();
    const id = createTextObj(100, 100, 'mine');
    pressAndRelease(textEl(id));
    keyDown(window, 'Enter');
    flush();
    expect(screen.queryByTestId('text-editor')).not.toBeNull();

    const objects = board().doc.getMap<Y.Map<unknown>>('objects');
    act(() => {
      board().doc.transact(() => objects.delete(id));
    });
    flush();

    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(screen.queryByTestId('text-object')).toBeNull();
    expect(textObjects()).toHaveLength(0);
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('TC-25: Ctrl+Z reverts typed text and the stored box together in one step', () => {
    render(<App />);
    flush();
    const id = createTextObj(100, 100);
    pressAndRelease(textEl(id));
    keyDown(window, 'Enter');
    flush();

    const long = 'the quick brown fox jumps over the lazy dog and keeps running';
    fireEvent.input(editor(), { target: { value: long } });
    flush();
    fireEvent.keyDown(editor(), { key: 'Escape' });
    flush();
    const typed = textObjects()[0];
    expect(typed.text).toBe(long);
    const initialHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(typed.height).toBeGreaterThan(initialHeight);

    ctrlZ();

    const reverted = textObjects()[0];
    expect(reverted.text).toBe('');
    expect(reverted.height).toBe(initialHeight);
  });
});
