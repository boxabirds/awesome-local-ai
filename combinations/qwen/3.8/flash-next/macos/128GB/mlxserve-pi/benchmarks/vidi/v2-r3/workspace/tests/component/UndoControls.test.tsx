// Story 8, `undo.controls`: the two buttons and the four shortcuts through which
// a person reaches their own history. They are disabled when there is nothing of
// theirs to undo or redo, or when the board cannot be edited at all (TC-18,
// TC-20); they reach the board’s own undo and nothing else’s (TC-19); and a
// shortcut pressed somewhere that is not the board — a caret in the share link,
// where Ctrl+Z means the browser’s own undo — is left alone (TC-21).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import {
  createNote,
  flushFrame,
  noteCount,
  noteData,
  noteEl,
  pressOn,
  moveTo,
  releaseOn,
  renderBoard,
  surfaceOf,
} from './helpers';
import { Board } from '../../src/client/board/Board';
import { SharePanel } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import type { StickySnapshot } from '../../src/shared/board-model';

let doc: Doc;

const NOTE_SCREEN = { x: 600, y: 350 };

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
});

afterEach(() => {
  vi.useRealTimers();
});

function undoButton(): HTMLButtonElement {
  return screen.getByLabelText('Undo') as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByLabelText('Redo') as HTMLButtonElement;
}

function at(id: string): StickySnapshot {
  const data = noteData(doc, id);
  if (data === undefined) throw new Error(`note ${id} is gone from the model`);
  return data;
}

/** Press a key with the focus on the board itself. */
function pressOnBoard(key: string, modifiers: Record<string, boolean> = {}): boolean {
  return fireEvent(document.body, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
}

/** Press a key with the focus on a given element. */
function pressIn(el: Element, key: string, modifiers: Record<string, boolean> = {}): boolean {
  return fireEvent.keyDown(el, { key, ...modifiers });
}

/** Drag a note a little way: one step of mine. */
function moveNote(id: string): StickySnapshot {
  const before = at(id);
  const el = noteEl(id);
  pressOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
  moveTo(el, NOTE_SCREEN.x + 80, NOTE_SCREEN.y + 40);
  flushFrame();
  releaseOn(el, NOTE_SCREEN.x + 80, NOTE_SCREEN.y + 40);
  flushFrame();
  return before;
}

// --- TC-18 --------------------------------------------------------------------

describe('TC-18: the buttons say what the history holds', () => {
  it('disables both buttons while there is nothing of mine to undo or redo', () => {
    const undo = undoButton();
    const redo = redoButton();
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    expect(redo.getAttribute('aria-disabled')).toBe('true');
  });

  it('enables Undo as soon as I do something, and Redo as soon as I undo it', () => {
    createNote(doc, 0, 0);

    expect(undoButton().disabled).toBe(false);
    expect(undoButton().getAttribute('aria-disabled')).toBeNull();
    expect(redoButton().disabled).toBe(true);

    fireEvent.click(undoButton());
    flushFrame();

    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
    expect(redoButton().getAttribute('aria-disabled')).toBeNull();
  });

  it('carries a shortcut press onto the buttons, and a button press onto the shortcuts', () => {
    createNote(doc, 0, 0);
    expect(redoButton().disabled).toBe(true);

    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(0);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    pressOnBoard('y', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(1);
    // The step is back on the undo side of the history, where it came from.
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  it('shows the shortcut in each button’s tooltip', () => {
    expect(undoButton().title).toContain('Ctrl');
    expect(redoButton().title).toContain('Ctrl');
  });

  it('sits in the board toolbar, so it is one of the board’s own tools', () => {
    const toolbar = screen.getByTestId('toolbar');
    expect(toolbar.contains(undoButton())).toBe(true);
    expect(toolbar.contains(redoButton())).toBe(true);
  });
});

// --- TC-19 --------------------------------------------------------------------

describe('TC-19: the shortcuts reach my own undo and redo', () => {
  it('undoes with Ctrl+Z', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);
    moveNote(id);
    expect(at(id).x).not.toBe(start.x);

    expect(pressOnBoard('z', { ctrlKey: true })).toBe(false); // the browser’s undo suppressed
    flushFrame();
    expect(at(id).x).toBe(start.x); // my move, gone

    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(0); // the note’s creation, one press later
  });

  it('undoes with Cmd+Z', () => {
    createNote(doc, 0, 0);

    expect(pressOnBoard('z', { metaKey: true })).toBe(false);
    flushFrame();
    expect(noteCount()).toBe(0);
  });

  it('redoes with Ctrl+Shift+Z', () => {
    createNote(doc, 0, 0);
    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(0);

    expect(pressOnBoard('z', { ctrlKey: true, shiftKey: true })).toBe(false);
    flushFrame();
    expect(noteCount()).toBe(1);
  });

  it('redoes with Cmd+Shift+Z', () => {
    createNote(doc, 0, 0);
    pressOnBoard('z', { metaKey: true });
    flushFrame();
    expect(noteCount()).toBe(0);

    expect(pressOnBoard('z', { metaKey: true, shiftKey: true })).toBe(false);
    flushFrame();
    expect(noteCount()).toBe(1);
  });

  it('redoes with Ctrl+Y', () => {
    createNote(doc, 0, 0);
    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(0);

    expect(pressOnBoard('y', { ctrlKey: true })).toBe(false);
    flushFrame();
    expect(noteCount()).toBe(1);
  });

  it('undoes and redoes a move back to where it was', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);
    moveNote(id);
    const moved = at(id);
    expect(moved.x).not.toBe(start.x);

    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(at(id).x).toBe(start.x);

    pressOnBoard('z', { ctrlKey: true, shiftKey: true });
    flushFrame();
    expect(at(id).x).toBe(moved.x);
  });

  it('undoes only my own delete, and puts the notes back with a redo', () => {
    const mine = createNote(doc, 0, 0);
    createNote(doc, 400, 0);
    pressOnBoard('a', { ctrlKey: true }); // select all
    act(() => {
      fireEvent.click(screen.getByLabelText('Delete selection'));
    });
    flushFrame();
    expect(noteCount()).toBe(0);

    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(2);
    expect(at(mine).x).toBeDefined();

    pressOnBoard('y', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(0);
  });

  it('does nothing when there is nothing to undo, without disturbing the board', () => {
    createNote(doc, 0, 0);
    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(noteCount()).toBe(0);

    // Undo has run out: the press is ignored, and nothing is deleted twice.
    expect(pressOnBoard('z', { ctrlKey: true })).toBe(false);
    flushFrame();
    expect(noteCount()).toBe(0);
    expect(undoButton().disabled).toBe(true);
  });

  it('leaves Ctrl+Z to the browser when a shape of my own is not what has focus', () => {
    // The board’s own text editor keeps its Ctrl+Z (TC-16); here the board is
    // what has focus, so the board answers.
    createNote(doc, 0, 0);
    const surface = surfaceOf(document.body);
    expect(fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })).toBe(false);
    flushFrame();
    expect(noteCount()).toBe(0);
  });
});

// --- TC-20 --------------------------------------------------------------------

describe('TC-20: a board that could not be loaded has no history to offer', () => {
  /** The board, its document, and the room connection it made. */
  function openBoard(): { doc: Doc; provider: WebsocketProvider } {
    // This test owns the page on its own: the board the file’s beforeEach put
    // there is taken down first, so there is exactly one board, one toolbar and
    // one set of shortcuts in play.
    cleanup();
    let board: Doc | null = null;
    let provider: WebsocketProvider | null = null;
    act(() => {
      render(
        <Board
          onDocReady={(d: Doc) => {
            board = d;
          }}
          onProviderReady={(p: WebsocketProvider) => {
            provider = p;
          }}
        />,
      );
    });
    if (board === null) throw new Error('the board did not expose its document');
    if (provider === null) throw new Error('the board did not expose its connection');
    return { doc: board, provider };
  }

  /** Take the board down the way the room does when it cannot load one. */
  function failTheLoad(provider: WebsocketProvider): void {
    act(() => {
      provider.emit('connection-close', [{ code: CLOSE_BOARD_LOAD_FAILED }, provider] as never);
    });
    flushFrame();
  }

  it('disables both buttons although I have a change of mine to undo', () => {
    const { doc: board, provider } = openBoard();
    createNote(board, 0, 0);
    expect(undoButton().disabled).toBe(false);

    failTheLoad(provider);

    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().disabled).toBe(true);
  });

  it('ignores every undo and redo shortcut once the load has failed', () => {
    const { doc: board, provider } = openBoard();
    createNote(board, 0, 0);
    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(board.getMap('objects').size).toBe(0); // the undo really ran, first

    failTheLoad(provider);

    pressOnBoard('y', { ctrlKey: true }); // would redo the note if it ran
    flushFrame();
    expect(board.getMap('objects').size).toBe(0);
    expect(pressOnBoard('z', { ctrlKey: true })).toBe(true); // not swallowed
    expect(board.getMap('objects').size).toBe(0);
  });

  it('writes nothing from a click of the disabled buttons', () => {
    const { doc: board, provider } = openBoard();
    createNote(board, 0, 0);
    failTheLoad(provider);

    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    flushFrame();
    expect(board.getMap('objects').size).toBe(1); // as it was when the load failed
  });
});

// --- TC-21 --------------------------------------------------------------------

describe('TC-21: a shortcut pressed outside the board is not the board’s undo', () => {
  /** The board, its document, and the share panel’s link field. */
  function openBoardWithShare(): { doc: Doc; link: HTMLInputElement } {
    cleanup(); // as above: one board on the page, one set of shortcuts
    const boardId = newBoardId();
    let board: Doc | null = null;
    act(() => {
      render(
        <>
          <Board
            boardId={boardId}
            onDocReady={(d: Doc) => {
              board = d;
            }}
          />
          <SharePanel boardId={boardId} />
        </>,
      );
    });
    if (board === null) throw new Error('the board did not expose its document');
    // The page now holds this board and no other, so it is the document every
    // helper in this file reads.
    doc = board;
    // The link field is in the share panel, which opens from its own button.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    const link = screen.getByLabelText('Board link') as HTMLInputElement;
    return { doc: board, link };
  }

  it('leaves Ctrl+Z to the field when the caret is in the share link', () => {
    const { doc: board, link } = openBoardWithShare();
    const id = createNote(board, 0, 0);
    moveNote(id); // one step of mine, so Undo has something to take
    const moved = at(id);

    link.focus();
    expect(pressIn(link, 'z', { ctrlKey: true })).toBe(true); // nobody prevented it
    flushFrame();

    expect(at(id).x).toBe(moved.x); // my move is where I left it
    expect(undoButton().disabled).toBe(false);
  });

  it('takes the same key press as the board’s own undo the moment focus is back on the board', () => {
    const { doc: board, link } = openBoardWithShare();
    const id = createNote(board, 0, 0);
    dragOnce(id);
    const moved = at(id);

    link.focus();
    pressIn(link, 'z', { ctrlKey: true });
    flushFrame();
    expect(at(id).x).toBe(moved.x);

    link.blur();
    pressOnBoard('z', { ctrlKey: true });
    flushFrame();
    expect(at(id).x).not.toBe(moved.x); // now the board answered
  });

  it('leaves Cmd+Shift+Z to the field too, and redoes nothing of mine', () => {
    const { doc: board, link } = openBoardWithShare();
    const id = createNote(board, 0, 0);
    pressIn(link, 'z', { ctrlKey: true }); // nothing to undo yet
    expect(board.getMap('objects').size).toBe(1);

    link.focus();
    expect(pressIn(link, 'z', { ctrlKey: true, shiftKey: true })).toBe(true);
    flushFrame();
    expect(board.getMap('objects').size).toBe(1);
    expect(redoButton().disabled).toBe(true);
  });

  it('ignores the shortcuts in any other field of the app as well', () => {
    const { doc: board, link } = openBoardWithShare();
    const id = createNote(board, 0, 0);
    dragOnce(id);
    const moved = at(id);

    // A field of the person’s own, not the app’s: same rule, same answer.
    const own = document.createElement('input');
    document.body.appendChild(own);
    own.focus();
    expect(pressIn(own, 'y', { ctrlKey: true })).toBe(true);
    flushFrame();
    expect(at(id).x).toBe(moved.x);
    expect(board.getMap('objects').size).toBe(1);
    own.remove();
  });
});

/** Drag a note once, so my history has one step in it. */
function dragOnce(id: string): void {
  const el = noteEl(id);
  pressOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
  moveTo(el, NOTE_SCREEN.x + 80, NOTE_SCREEN.y + 40);
  flushFrame();
  releaseOn(el, NOTE_SCREEN.x + 80, NOTE_SCREEN.y + 40);
  flushFrame();
}
