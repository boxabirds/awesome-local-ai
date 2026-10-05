/**
 * Somebody else typing in the note you are typing in.
 *
 * The editor holds its own copy of the text — that is what gives the browser's
 * caret, undo and input methods room to work — so a change that arrives from
 * another person has to be poured into that copy. If it is not, the next keystroke
 * writes the stale copy to the document and their characters disappear. These are
 * the jsdom-level tests for that pouring; the same thing with two real browsers is
 * TC-23.
 */

import { cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import {
  doubleClick,
  fireInput,
  flushCameraFrame,
  stickyEditor,
  stubResizeObserver,
  stubViewportGeometry,
  viewportElement
} from './harness';

interface BoardFixture {
  doc: Y.Doc;
  result: RenderResult;
  root: HTMLElement;
  /** The text of the only note on the board. */
  text(): string;
}

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function boardWithOneNote(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result = render(<App doc={doc} />);
  await flushCameraFrame();
  doubleClick(viewportElement(result.container), 500, 350);
  return {
    doc,
    result,
    root: result.container,
    text: () => {
      const notes = snapshot(doc);
      if (notes.length !== 1) throw new Error(`the board holds ${notes.length} notes`);
      return getStickyText(doc, notes[0].id)?.toString() ?? '';
    }
  };
}

/** The one note's shared text. */
function ytextOf(board: BoardFixture): Y.Text {
  const [only] = snapshot(board.doc);
  const text = getStickyText(board.doc, only.id);
  if (!text) throw new Error('the note has no text to share');
  return text;
}

/** The editor, which has to be open: these tests are about typing. */
function editorOf(board: BoardFixture): HTMLTextAreaElement {
  const editor = stickyEditor(board.root);
  if (!editor) throw new Error('no note is being edited');
  return editor;
}

/** Type at the caret, the way a person does, and let the board see it. */
function typeHere(board: BoardFixture, text: string): void {
  const editor = editorOf(board);
  const from = editor.selectionStart ?? editor.value.length;
  const to = editor.selectionEnd ?? editor.value.length;
  const next = editor.value.slice(0, from) + text + editor.value.slice(to);
  editor.value = next;
  editor.setSelectionRange(from + text.length, from + text.length);
  fireInput(editor, next);
}

/** Type in the note as somebody else, so it arrives as their typing would. */
function typeThere(board: BoardFixture, at: number, text: string): void {
  const shared = ytextOf(board);
  shared.doc?.transact(() => shared.insert(at, text), 'somebody-else');
}

describe('text arriving while you type', () => {
  it('shows up in the editor instead of being overwritten', async () => {
    const board = await boardWithOneNote();
    typeHere(board, 'goals');
    expect(board.text()).toBe('goals');

    typeThere(board, 5, ' learned');

    expect(editorOf(board).value).toBe('goals learned');
    expect(board.text()).toBe('goals learned');
  });

  it('survives the next keystroke, so nothing of theirs is lost', async () => {
    const board = await boardWithOneNote();
    typeHere(board, 'goals');
    // Theirs lands before the caret, which is the worst case for a stale buffer.
    typeThere(board, 0, 'our ');

    typeHere(board, '!');

    expect(board.text()).toBe('our goals!');
    expect(editorOf(board).value).toBe('our goals!');
  });

  it('leaves the caret where your own typing left it', async () => {
    const board = await boardWithOneNote();
    typeHere(board, 'goals');
    // Theirs arrives at the end of the note, after the caret.
    typeThere(board, 5, ' learned');

    typeHere(board, '!');

    // Your typing carries on where you had it; theirs follows.
    expect(board.text()).toBe('goals! learned');
  });

  it('carries the caret along with text that arrives before it', async () => {
    const board = await boardWithOneNote();
    typeHere(board, 'goals');
    typeHere(board, ' and targets');
    // The caret sits at 5, in the middle of what you typed.
    const editor = editorOf(board);
    editor.setSelectionRange(5, 5);

    typeThere(board, 0, 'our ');

    expect(editorOf(board).selectionStart).toBe(9);
    typeHere(board, '!');
    expect(board.text()).toBe('our goals! and targets');
  });
});
