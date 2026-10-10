/**
 * Sticky note text editing (tasks 2.4-2.7): start/end editing, the write-on-
 * every-input contract, the length limit and the counter, IME composition,
 * and deletion of a note mid-edit. The font auto-fit needs real layout, so
 * it is verified in tests/e2e/sticky-notes.spec.ts (TC-33) instead.
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import {
  dispatchKey,
  noteById,
  pointerEvent,
  readNotes,
  renderStickyBoard,
  seedSticky,
  textOf,
} from './helpers/board';
import { deleteObject } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_1000 } from '../fixtures/texts';

const NOTE = { x: 400, y: 300 };
const INSIDE = { x: NOTE.x + 50, y: NOTE.y + 50 };

let doc: YDoc;
let id: string;

beforeEach(() => {
  doc = new Doc();
  id = seedSticky(doc, { ...NOTE, text: 'Retro' });
  renderStickyBoard(doc);
});

afterEach(cleanup);

function selectNote(): HTMLElement {
  const note = noteById(id);
  pointerEvent('pointerDown', note, INSIDE);
  pointerEvent('pointerUp', note, INSIDE);
  return note;
}

function textDiv(): HTMLElement {
  return screen.getByTestId('sticky-text');
}

function type(textarea: HTMLElement, value: string): void {
  fireEvent.change(textarea, { target: { value } });
}

describe('sticky.edit_start / sticky.edit_end (TC-23, TC-24, TC-38)', () => {
  it('TC-23: Enter starts editing; typing shows in the note; Escape ends it and keeps the text', () => {
    const note = selectNote();
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();

    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');
    expect(document.activeElement).toBe(textarea); // focused on mount
    // Caret at the end of the existing text.
    const area = textarea as HTMLTextAreaElement;
    expect(area.selectionStart).toBe('Retro'.length);
    expect(area.selectionEnd).toBe('Retro'.length);
    // The toolbar is hidden while editing.
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    // Counter hidden for short text.
    expect(screen.queryByTestId('char-counter')).toBeNull();

    type(textarea, 'Retro!');
    expect(textOf(doc, id)).toBe('Retro!'); // written on every input event
    expect(textDiv().textContent).toBe('Retro!');

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(textOf(doc, id)).toBe('Retro!'); // kept
    expect(note.dataset.selected).toBe('true'); // ends in Selected
  });

  it('TC-24: Escape keeps the text and leaves the note selected', () => {
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');
    type(textarea, 'kept');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(textOf(doc, id)).toBe('kept');
    expect(noteById(id).dataset.selected).toBe('true');
  });

  it('TC-38: a pointerdown outside the note ends editing as unselected, text kept', () => {
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');
    type(textarea, 'outside');

    // A press on empty board space (not on the note).
    fireEvent.pointerDown(screen.getByTestId('board-viewport'), {
      pointerId: 1,
      button: 0,
      clientX: 900,
      clientY: 650,
    });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(noteById(id).dataset.selected).toBe('false');
    expect(textOf(doc, id)).toBe('outside');
  });

  it('the caret starts at the end when editing an existing note (edit_start)', () => {
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');
    expect((textarea as HTMLTextAreaElement).value).toBe('Retro');
  });
});

describe('sticky.text_limit (TC-32 equivalent, jsdom-safe parts)', () => {
  it('the counter appears at 950 of 1,000, and input past 1,000 is clamped', () => {
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');

    type(textarea, PROSE_1000.slice(0, 949));
    expect(screen.queryByTestId('char-counter')).toBeNull();

    type(textarea, PROSE_1000.slice(0, 950));
    const counter = screen.getByTestId('char-counter');
    expect(counter.textContent).toBe(`950/${STICKY_TEXT_MAX_CHARS}`);

    type(textarea, PROSE_1000);
    expect(screen.getByTestId('char-counter').textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
    expect(textOf(doc, id)).toBe(PROSE_1000);

    // Past the limit: the extra characters are dropped and never written.
    type(textarea, `${PROSE_1000}xyz`);
    expect(textOf(doc, id)).toBe(PROSE_1000);
    expect((textarea as HTMLTextAreaElement).value.length).toBe(STICKY_TEXT_MAX_CHARS);
    // jsdom has no layout: the overflow fade is checked in e2e (TC-33).
    expect(noteById(id).dataset.overflow).toBe('false');
  });
});

describe('IME composition (sticky.text_limit / edit contract)', () => {
  it('input is not written while composing and lands in full on compositionend', () => {
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');

    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'n' } });
    fireEvent.change(textarea, { target: { value: 'に' } });
    expect(textOf(doc, id)).toBe('Retro'); // nothing written mid-composition
    fireEvent.compositionEnd(textarea, { data: 'に' });
    expect(textOf(doc, id)).toBe('に');
    expect((textarea as HTMLTextAreaElement).value).toBe('に');
  });
});

describe('keys while editing (TC-26) and stale interactions (TC-37)', () => {
  it('TC-26: Delete and Backspace while editing go to the text, not the note', () => {
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');
    type(textarea, 'keep me');

    // The keys originate from the focused textarea, as in a browser.
    dispatchKey({ key: 'Backspace' }, textarea);
    dispatchKey({ key: 'Delete' }, textarea);
    expect(readNotes(doc)).toHaveLength(1);
    expect(textOf(doc, id)).toBe('keep me');

    // Only after the edit ended does the keyboard delete work (TC-25).
    fireEvent.keyDown(textarea, { key: 'Escape' });
    dispatchKey({ key: 'Delete' });
    expect(readNotes(doc)).toHaveLength(0);
  });

  it('TC-37: deleting a note mid-edit removes it with no errors and no writes', () => {
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = screen.getByTestId('sticky-textarea');
    type(textarea, 'half typed');

    // Another user deletes the note while this client is editing.
    act(() => {
      doc.transact(() => {
        deleteObject(doc, id);
      });
    });

    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(readNotes(doc)).toHaveLength(0);
  });
});
