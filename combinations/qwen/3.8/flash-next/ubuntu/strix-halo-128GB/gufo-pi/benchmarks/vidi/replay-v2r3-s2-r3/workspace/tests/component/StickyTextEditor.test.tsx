import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../src/client/App';
import { getStickyText } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../src/shared/config';
import { flushRaf, getDoc, getNotes, makeNote, noteEl, textarea } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Create a note, select it and press Enter (the design's edit-start path). */
function startEditingWith(text: string): string {
  const id = makeNote();
  act(() => {
    getStickyText(getDoc(), id)!.insert(0, text);
  });
  flushRaf();

  const el = noteEl(id);
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 400, clientY: 400, button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 400, clientY: 400, pointerType: 'mouse' });
  flushRaf();

  fireEvent.keyDown(window, { key: 'Enter' });
  flushRaf();
  return id;
}

function type(value: string) {
  fireEvent.change(textarea()!, { target: { value } });
  flushRaf();
}

describe('StickyTextEditor start and end', () => {
  // TC-23
  it('TC-23 opens the editor on Enter with the caret at the end of the text', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('Faster onboarding');

    const field = textarea();
    expect(field).not.toBeNull();
    expect(field!.value).toBe('Faster onboarding');
    expect(document.activeElement).toBe(field);
    expect(field!.selectionStart).toBe('Faster onboarding'.length);
    expect(field!.selectionEnd).toBe('Faster onboarding'.length);
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
  });

  // TC-24
  it('TC-24 keeps the text and returns to Selected on Escape', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('abc');

    type('abcdef');
    expect(getStickyText(getDoc(), id)!.toString()).toBe('abcdef');

    fireEvent.keyDown(textarea()!, { key: 'Escape', bubbles: true, cancelable: true });
    flushRaf();

    expect(textarea()).toBeNull();
    expect(getStickyText(getDoc(), id)!.toString()).toBe('abcdef');
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    // The note shows the text again
    expect(screen.getByTestId('sticky-text').textContent).toBe('abcdef');
  });

  // TC-38
  it('TC-38 writes what was typed and deselects on a click outside the note', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('');

    type('abc');
    expect(getStickyText(getDoc(), id)!.toString()).toBe('abc');

    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 950, clientY: 700, pointerType: 'mouse' });
    fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 950, clientY: 700, pointerType: 'mouse' });
    flushRaf();

    expect(textarea()).toBeNull();
    expect(getStickyText(getDoc(), id)!.toString()).toBe('abc');
    expect(noteEl(id).getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('writes every input event to Y.Text, and Enter adds a newline', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('');

    type('He');
    expect(getStickyText(getDoc(), id)!.toString()).toBe('He');
    type('Hello');
    expect(getStickyText(getDoc(), id)!.toString()).toBe('Hello');

    fireEvent.keyDown(textarea()!, { key: 'Enter', bubbles: true, cancelable: true });
    flushRaf();
    expect(textarea()).not.toBeNull();

    type('Hello\nworld');
    expect(getStickyText(getDoc(), id)!.toString()).toBe('Hello\nworld');
    expect(screen.queryByTestId('sticky-text')).toBeNull();
  });

  it('writes nothing while an IME composition is in progress, then writes it once', () => {
    // Not a real IME (jsdom has none); it verifies the composition guard the
    // design calls for, so composition cannot duplicate characters.
    render(<App />);
    flushRaf();
    const id = startEditingWith('');
    const field = textarea()!;

    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'nihon' } });
    fireEvent.change(field, { target: { value: 'にほん' } });
    flushRaf();
    expect(getStickyText(getDoc(), id)!.toString()).toBe('');

    fireEvent.compositionEnd(field);
    flushRaf();
    expect(getStickyText(getDoc(), id)!.toString()).toBe('にほん');

    // Normal typing continues afterwards
    type('にほんご');
    expect(getStickyText(getDoc(), id)!.toString()).toBe('にほんご');
  });

  it('keeps multi-line text intact when editing ends', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('');
    const multiline = 'What slowed us down?\nDeploys by hand.\nAutomate the pipeline.';
    type(multiline);
    fireEvent.keyDown(textarea()!, { key: 'Escape', bubbles: true, cancelable: true });
    flushRaf();
    expect(getStickyText(getDoc(), id)!.toString()).toBe(multiline);
    expect(screen.getByTestId('sticky-text').style.whiteSpace).toBe('pre-wrap');
  });
});

describe('StickyTextEditor length limit', () => {
  // TC-26 (negative for sticky.delete while editing)
  it('TC-26 edits characters instead of deleting the note on Backspace', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('ab');

    type('a');
    fireEvent.keyDown(textarea()!, { key: 'Backspace', bubbles: true, cancelable: true });
    flushRaf();

    expect(getNotes()).toHaveLength(1);
    expect(getStickyText(getDoc(), id)!.toString()).toBe('a');
    expect(textarea()).not.toBeNull();
  });

  it('keeps the first 1,000 characters of a long paste', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('');
    const paste = 'x'.repeat(STICKY_TEXT_MAX_CHARS + 200);

    type(paste);

    const kept = getStickyText(getDoc(), id)!.toString();
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(paste.startsWith(kept)).toBe(true);
  });

  it('shows the counter once 50 or fewer characters remain', () => {
    render(<App />);
    flushRaf();
    const id = startEditingWith('');
    const limit = STICKY_TEXT_MAX_CHARS;

    type('a'.repeat(limit - STICKY_COUNTER_THRESHOLD_CHARS - 1)); // 949
    expect(screen.queryByTestId('sticky-counter')).toBeNull();

    type('a'.repeat(limit - STICKY_COUNTER_THRESHOLD_CHARS)); // 950
    expect(screen.getByTestId('sticky-counter').textContent).toBe('950/1000');

    type('a'.repeat(limit)); // 1000
    expect(screen.getByTestId('sticky-counter').textContent).toBe(`${limit}/${limit}`);
    expect(getStickyText(getDoc(), id)!.toString()).toHaveLength(limit);
  });
});
