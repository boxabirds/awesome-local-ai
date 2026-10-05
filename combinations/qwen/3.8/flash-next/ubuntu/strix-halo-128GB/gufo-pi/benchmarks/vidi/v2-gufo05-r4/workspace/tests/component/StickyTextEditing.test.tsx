/**
 * Story 2 component tests: typing text into a sticky note — the character limit,
 * the counter, IME commits, and the ways editing ends.
 */

import { cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { snapshot } from '../../src/shared/board-model';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS
} from '../../src/shared/config';
import {
  doubleClick,
  fireComposition,
  fireInput,
  fireKey,
  firePaste,
  firePointer,
  flushCameraFrame,
  stickyEditor,
  stickyNote,
  stubResizeObserver,
  stubViewportGeometry,
  viewportElement
} from './harness';
import { PROSE_1000, SHORT_PHRASE, proseOfLength } from '../fixtures/texts';

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  notes(): ReturnType<typeof snapshot>;
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

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result = render(<App doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, notes: () => snapshot(doc) };
}

/** Double-click the board and return the textarea of the new note. */
async function startNote(board: BoardFixture): Promise<HTMLTextAreaElement> {
  doubleClick(viewportElement(board.root), 400, 300);
  const editor = stickyEditor(board.root);
  if (!editor) throw new Error('double-clicking the board did not open a note for typing');
  return editor;
}

function counter(board: BoardFixture): HTMLElement | null {
  return board.root.querySelector('[data-testid="sticky-counter"]');
}

describe('typing into a note (sticky.text)', () => {
  it('TC-30: typed text is stored and shown on the note', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);

    fireInput(editor, SHORT_PHRASE);

    expect(board.notes()[0].text).toBe(SHORT_PHRASE);
    // While typing, the textarea holds it; the note shows it when editing ends.
    expect(stickyEditor(board.root)!.value).toBe(SHORT_PHRASE);
  });

  it('the counter stays hidden until the note is within reach of the limit', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    const boundary = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;

    fireInput(editor, proseOfLength(boundary - 1));
    expect(counter(board)).toBeNull();

    fireInput(editor, proseOfLength(boundary));
    expect(counter(board)).not.toBeNull();
    expect(counter(board)!.textContent).toBe(`${boundary}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('TC-16: a paste longer than the limit keeps exactly the first 1,000 characters', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);

    firePaste(editor, `${PROSE_1000}overflow`);

    expect(board.notes()[0].text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(board.notes()[0].text).toBe(PROSE_1000);
    // The user is left at the end of the text that fitted, not past it.
    const area = stickyEditor(board.root)!;
    expect(area.value).toBe(PROSE_1000);
    expect(area.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(counter(board)!.textContent).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('characters typed after the limit are ignored, and existing text is untouched', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    firePaste(editor, PROSE_1000);

    // A browser would refuse nothing here: the component trims what arrived.
    fireInput(stickyEditor(board.root)!, `${PROSE_1000}more`);

    expect(board.notes()[0].text).toBe(PROSE_1000);
  });

  it('TC-31: text committed by an input method lands once, without fragments', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    fireInput(editor, 'ship ');

    // A Japanese input method: the romanised text is typed first, then the
    // candidate replaces it in one commit.
    fireComposition(editor, 'ship ', 'kaeru', 'かえる');

    expect(board.notes()[0].text).toBe('ship かえる');
    expect(board.notes()[0].text).not.toContain('kaeru');
  });

  it('typing keeps the note itself where it is', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    const before = board.notes()[0];

    fireInput(editor, 'a note that stays put while it is written');

    const after = board.notes()[0];
    expect(after).toMatchObject({ id: before.id, x: before.x, y: before.y, color: before.color });
  });
});

describe('ending and starting text editing (sticky.text.edit)', () => {
  it('TC-32: Enter on a selected note starts editing with the caret at the end', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    fireInput(editor, 'existing thought');
    fireKey('Escape', { target: editor });

    fireKey('Enter'); // the note is still selected

    const reopened = stickyEditor(board.root)!;
    expect(reopened).not.toBeNull();
    expect(reopened.value).toBe('existing thought');
    expect(reopened.selectionStart).toBe('existing thought'.length);
    expect(document.activeElement).toBe(reopened);
  });

  it('TC-30: Escape keeps every character and leaves the note selected', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    fireInput(editor, 'half-written idea');

    fireKey('Escape', { target: editor });

    expect(board.notes()[0].text).toBe('half-written idea');
    expect(stickyEditor(board.root)).toBeNull();
    expect(stickyNote(board.root, 0).dataset.selected).toBe('true');
    expect(board.root.querySelector('[data-testid="sticky-text"]')!.textContent).toBe(
      'half-written idea'
    );
  });

  it('clicking the board keeps the text and lets go of the note', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    fireInput(editor, 'kept by the click outside');

    firePointer(viewportElement(board.root), 'pointerdown', 1000, 700);
    firePointer(viewportElement(board.root), 'pointerup', 1000, 700);

    expect(board.notes()[0].text).toBe('kept by the click outside');
    expect(stickyEditor(board.root)).toBeNull();
    expect(stickyNote(board.root, 0).dataset.selected).toBe('false');
  });

  it('clicking inside the note being typed in does not end editing', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    fireInput(editor, 'still typing here');

    // A click inside the note moves the caret; it is not a click outside.
    firePointer(stickyNote(board.root, 0), 'pointerdown', 420, 320);

    expect(stickyEditor(board.root)).not.toBeNull();
    expect(board.notes()[0].text).toBe('still typing here');
  });

  it('Enter inside the text adds a newline instead of ending editing', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    fireInput(editor, 'two lines');

    // The browser inserts the newline itself; the component only sees the result.
    fireInput(stickyEditor(board.root)!, 'two lines\n');

    expect(board.notes()[0].text).toBe('two lines\n');
    expect(stickyEditor(board.root)).not.toBeNull();
  });

  it('editing the same note again shows what is already there', async () => {
    const board = await renderBoard();
    const editor = await startNote(board);
    fireInput(editor, 'first pass');
    fireKey('Escape', { target: editor });

    doubleClick(stickyNote(board.root, 0), 400, 300);

    expect(stickyEditor(board.root)!.value).toBe('first pass');
  });
});
