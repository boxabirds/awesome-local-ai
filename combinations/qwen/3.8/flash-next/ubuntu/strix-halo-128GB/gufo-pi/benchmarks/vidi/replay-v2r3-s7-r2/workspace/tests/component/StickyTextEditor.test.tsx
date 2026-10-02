import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_NOTE_1000, proseOfLength } from '../fixtures/texts';
import { pointer, frames, typeInto } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(text = '') {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  const doc = handle.doc;
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 0, y: 0 });
    if (text) getStickyText(doc, id)!.insert(0, text);
  });
  frames();
  return { handle, doc, id };
}

/** Select the single note on the board with the pointer. */
function selectNote() {
  const note = screen.getByTestId('sticky-note');
  pointer(note, 'pointerdown', 640, 400);
  pointer(note, 'pointerup', 640, 400);
  frames();
  return note;
}

const editor = () => screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement;

describe('StickyTextEditor', () => {
  it('TC-23: Enter starts editing the selected note with focus and the caret at the end', () => {
    const { handle, id } = setup('Hello');
    selectNote();

    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    expect(handle.getEditingId()).toBe(id);
    const el = editor();
    expect(document.activeElement).toBe(el);
    expect(el.value).toBe('Hello');
    expect(el.selectionStart).toBe(5);
    expect(el.selectionEnd).toBe(5);
  });

  it('TC-24: Escape ends editing and keeps the typed text', () => {
    const { handle, doc, id } = setup();
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    typeInto(editor(), 'retro');
    frames();
    expect(getStickyText(doc, id)!.toString()).toBe('retro');

    fireEvent.keyDown(editor(), { key: 'Escape' });
    frames();

    expect(handle.getEditingId()).toBeNull();
    expect(handle.getSelectedId()).toBe(id);
    expect(screen.queryByTestId('sticky-note-editor')).not.toBeInTheDocument();
    expect(getStickyText(doc, id)!.toString()).toBe('retro');
    expect(screen.getByTestId('sticky-note-text')).toHaveTextContent('retro');
  });

  it('TC-26: Backspace while editing deletes one character, not the note', () => {
    const { handle, doc, id } = setup('ab');
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    typeInto(editor(), 'a');
    frames();

    expect(snapshot(doc)).toHaveLength(1);
    expect(getStickyText(doc, id)!.toString()).toBe('a');
    expect(handle.getSelectedId()).toBe(id);
    expect(handle.getEditingId()).toBe(id);
  });

  it('TC-38: typing then clicking outside unmounts the editor with the text kept', () => {
    const { handle, doc, id } = setup();
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    typeInto(editor(), 'abc');
    frames();
    expect(getStickyText(doc, id)!.toString()).toBe('abc');

    pointer(document.querySelector<HTMLElement>('[data-grid-layer="true"]')!, 'pointerdown', 20, 20);
    frames();

    expect(screen.queryByTestId('sticky-note-editor')).not.toBeInTheDocument();
    expect(getStickyText(doc, id)!.toString()).toBe('abc');
    expect(handle.getSelectedId()).toBeNull();
    expect(handle.getEditingId()).toBeNull();
  });

  it('typing writes through to the shared Y.Text on every input', () => {
    const { doc, id } = setup();
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    const el = editor();
    typeInto(el, 'h');
    frames();
    expect(getStickyText(doc, id)!.toString()).toBe('h');
    typeInto(el, 'hi');
    frames();
    expect(getStickyText(doc, id)!.toString()).toBe('hi');
  });

  it('Enter inside the editor inserts a newline instead of ending editing', () => {
    const { handle, doc, id } = setup('one');
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    const el = editor();
    typeInto(el, 'one\ntwo');
    fireEvent.keyDown(el, { key: 'Enter' });
    frames();

    expect(handle.getEditingId()).toBe(id);
    expect(getStickyText(doc, id)!.toString()).toBe('one\ntwo');
  });

  it('IME composition writes the final text once, not twice', () => {
    const { doc, id } = setup();
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    const el = editor();
    fireEvent.compositionStart(el);
    // Intermediate composition input is not written yet.
    el.value = 'ん';
    fireEvent.input(el);
    expect(getStickyText(doc, id)!.toString()).toBe('');

    // The IME replaces the composition with the final text.
    el.value = 'こんにちは';
    fireEvent.compositionEnd(el);
    frames();
    expect(getStickyText(doc, id)!.toString()).toBe('こんにちは');
  });

  it('text pasted past the limit is clamped and the caret stays at the end', () => {
    const { doc, id } = setup();
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    const el = editor();
    typeInto(el, LONG_NOTE_1000 + 'overflow');
    frames();

    expect(getStickyText(doc, id)!.toString()).toBe(LONG_NOTE_1000);
    expect(el.value).toBe(LONG_NOTE_1000);
    expect(el.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('inserting one character at the limit is rejected', () => {
    const { doc, id } = setup(LONG_NOTE_1000);
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    typeInto(editor(), LONG_NOTE_1000 + '!');
    frames();

    expect(getStickyText(doc, id)!.toString()).toBe(LONG_NOTE_1000);
  });

  it('the counter appears in the last 50 characters only', () => {
    const { id } = setup(proseOfLength(949));
    selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    expect(screen.queryByTestId('sticky-note-counter')).not.toBeInTheDocument();

    const el = editor();
    typeInto(el, proseOfLength(950));
    frames();
    const counter = screen.getByTestId('sticky-note-counter');
    expect(counter).toHaveTextContent('950/1000');

    typeInto(el, proseOfLength(951));
    frames();
    expect(screen.getByTestId('sticky-note-counter')).toHaveTextContent('951/1000');
    void id;
  });

  it('clicking inside the editing note keeps editing', () => {
    const { handle, id } = setup('keep me');
    const note = selectNote();
    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    pointer(note, 'pointerdown', 640, 400);
    pointer(note, 'pointerup', 640, 400);
    frames();

    expect(handle.getEditingId()).toBe(id);
    expect(screen.getByTestId('sticky-note-editor')).toBeInTheDocument();
  });
});
