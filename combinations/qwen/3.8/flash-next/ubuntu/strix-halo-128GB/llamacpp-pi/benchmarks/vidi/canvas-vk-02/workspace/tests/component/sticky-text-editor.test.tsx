// Component tests (jsdom): the sticky note text editor — typing writes the
// document, Escape / blur end editing, the counter appears at the threshold,
// input clamps at the limit, and Delete while editing edits text instead of
// deleting the note. Covers TC-23 to TC-26, TC-38 (behaviour).
//
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { Doc } from 'yjs';

import { createSticky, getStickyText, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { renderStickyBoard, type HarnessHandle } from './stickyHarness';

let doc: Doc;
let view: ReturnType<typeof renderStickyBoard>['view'];
let handle: HarnessHandle;
let note: StickySnapshot;

function mountSeeded(): void {
  const id = createSticky(doc, { x: 200, y: 200 });
  note = snapshot(doc).find((n) => n.id === id) as StickySnapshot;
  const r = renderStickyBoard(doc);
  view = r.view;
  handle = r.handle;
}

function selectAndEdit(): HTMLTextAreaElement {
  const el = view.getAllByTestId('sticky-note').find((e) => e.getAttribute('data-id') === note.id) as HTMLElement;
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });
  fireEvent.keyDown(window, { key: 'Enter' });
  return view.getByRole('textbox') as HTMLTextAreaElement;
}

function type(el: HTMLTextAreaElement, value: string): void {
  fireEvent.input(el, { target: { value } });
}

beforeEach(() => {
  doc = new Doc();
});

describe('editing text', () => {
  beforeEach(() => mountSeeded());

  it('typing writes straight to the document', () => {
    const input = selectAndEdit();
    type(input, 'Hello board');
    expect(getStickyText(doc, note.id)?.toString()).toBe('Hello board');
    expect(snapshot(doc)[0].text).toBe('Hello board');
  });

  it('Enter inserts a newline and does not end editing', () => {
    const input = selectAndEdit();
    type(input, 'two\nlines');
    expect(getStickyText(doc, note.id)?.toString()).toBe('two\nlines');
    expect(handle.editingId).toBe(note.id);
  });

  it('Escape keeps the text and leaves the note selected', () => {
    const input = selectAndEdit();
    type(input, 'committed');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getStickyText(doc, note.id)?.toString()).toBe('committed');
    expect(handle.editingId).toBeNull();
    expect(handle.selectedId).toBe(note.id);
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('blur commits the text and deselects', () => {
    const input = selectAndEdit();
    type(input, 'via blur');
    act(() => input.blur());
    expect(getStickyText(doc, note.id)?.toString()).toBe('via blur');
    expect(handle.editingId).toBeNull();
    expect(handle.selectedId).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('Delete / Backspace while editing edit the text, never the note', () => {
    const input = selectAndEdit();
    type(input, 'keep me');
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    // The note still exists; editing was not interrupted.
    expect(snapshot(doc)).toHaveLength(1);
    expect(handle.editingId).toBe(note.id);
    expect(view.queryByRole('textbox')).not.toBeNull();
  });
});

describe('character counter', () => {
  beforeEach(() => mountSeeded());

  it('stays hidden until the note is within 50 characters of the limit', () => {
    const input = selectAndEdit();
    type(input, 'x'.repeat(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)); // 949
    expect(view.queryByTestId('sticky-counter')).toBeNull();
    const atThreshold = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS; // 950
    type(input, 'x'.repeat(atThreshold));
    const counter = view.getByTestId('sticky-counter');
    expect(counter.textContent).toBe(`${atThreshold}/${STICKY_TEXT_MAX_CHARS}`);
  });
});

describe('maximum length', () => {
  beforeEach(() => mountSeeded());

  it('clamps input to the maximum and reports it in the counter', () => {
    const input = selectAndEdit();
    type(input, 'a'.repeat(STICKY_TEXT_MAX_CHARS + 50));
    expect(getStickyText(doc, note.id)?.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    const counter = view.getByTestId('sticky-counter');
    expect(counter.textContent).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });
});

describe('IME composition', () => {
  beforeEach(() => mountSeeded());

  it('commits composed text exactly once on compositionend', () => {
    const input = selectAndEdit();
    fireEvent.compositionStart(input);
    // During composition the browser holds the in-progress text in the value.
    fireEvent.input(input, { target: { value: 'ひらがな' } });
    // Nothing is committed to the document until composition ends.
    expect(getStickyText(doc, note.id)?.toString()).toBe('');
    Object.defineProperty(input, 'value', { value: 'ひらがな', writable: true, configurable: true });
    fireEvent.compositionEnd(input);
    expect(getStickyText(doc, note.id)?.toString()).toBe('ひらがな');
  });
});
