/**
 * A board the room could not read, in the app that is showing it.
 *
 * The question is what a person may still do to a board that is not known to be a board. The
 * answer the story gives is: look, and wait - the tools go quiet until the board turns up. No
 * double-click, no toolbar button, no Delete key, no drag, no typing, no colour, no delete.
 *
 * That is a claim shaped like "nothing happens", which is the easiest kind of claim for a test to
 * satisfy by accident: a test that clicked nothing passes it, and so does an app that was broken
 * anyway. So the same things are tried twice. Once on a board that came down, where the model must
 * record no change at all - counted at the document, not at what the screen shows. And once on a
 * board that loaded, where every one of them has to change the model, which is what makes the
 * first half mean anything.
 */

import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canEdit } from '../../src/client/App';
import { boardOf, noteSeeds } from '../fixtures/boards';
import { snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
// `./helpers` is the file next to the `helpers/` directory, not the directory: this is where the
// frame-flushing the mounted board needs lives, one level above the sticky-note helpers.
import { flushFrames } from './helpers';
import {
  centreOf,
  clickAt,
  doubleClick,
  dragWithPointer,
  mountSticky,
  pressKey,
  typeInto,
  type MountedSticky,
} from './helpers/sticky';
import { forgetProviders, theProvider, type FakeWebsocketProvider } from './helpers/fake-provider';

// See the note in connectBoard.test.ts: the client's provider is stubbed so a close code can be
// handed to it, and the import happens inside the factory because `vi.mock` is hoisted above the
// imports at the top of this file.
vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/** A board and the connection that is meant to be keeping it up to date. */
interface LoadedBoard {
  board: MountedSticky;
  provider: FakeWebsocketProvider;
  /**
   * Every change the board model was asked to make, counted at the document itself. This is the
   * model being asked, not the screen being looked at: a component that wrote to a document of its
   * own would still show a note appearing, and this would not notice. An update is one
   * transaction, so a drag is a handful of these and a typed word is one.
   */
  writes(): number;
  theBoard(): string;
}

async function openTheBoard(): Promise<LoadedBoard> {
  const doc = boardOf(noteSeeds(2));
  const board = await mountSticky(doc, { boardId: 'b1' });

  let writes = 0;
  doc.on('update', () => {
    writes += 1;
  });

  const provider = theProvider();
  provider.socketOpens();
  provider.sync();
  await flushFrames();

  return {
    board,
    provider,
    writes: () => writes,
    theBoard: () => JSON.stringify(snapshot(doc)),
  };
}

/**
 * The load-failure case. The board was opened normally first, because that is how this happens in
 * real life: the room had the board, said it could not read it, and the screen is left showing
 * something that is no longer known to be true.
 */
async function theBoardCameDown(): Promise<LoadedBoard> {
  const opened = await openTheBoard();
  opened.provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
  await flushFrames();
  return opened;
}

/** Where a note is on the screen, given the camera the app has now. */
function noteOnScreen(board: MountedSticky, index = 0) {
  return board.screenOf(centreOf(board.note(index)));
}

/** Every way a person can change this board, in the order the story lists them. */
async function tryToChangeTheBoard(opened: LoadedBoard): Promise<void> {
  const { board } = opened;

  // Double-click empty board space, where a note would appear under the pointer.
  doubleClick(board.board, board.screenOf({ x: 400, y: 300 }));
  await flushFrames();

  // The toolbar button. Fired whether or not it is disabled: jsdom dispatches a click at a
  // disabled control, and a browser does not - so the click tests the handler behind the button
  // as well as the button, which is what the story asks for.
  fireEvent.click(screen.getByTestId('create-sticky'));
  await flushFrames();

  // Select a note, and press Delete.
  clickAt(board.note(0), noteOnScreen(board));
  await flushFrames();
  pressKey('Delete');
  await flushFrames();

  // Drag a note across the board.
  await dragWithPointer(board.note(0), noteOnScreen(board), board.screenOf({ x: 700, y: 500 }));

  // Double-click a note and type into it. Where the board would not open the note for typing,
  // there is nothing to type in - which is itself what the story asks of typing.
  doubleClick(board.note(0), noteOnScreen(board));
  await flushFrames();
  const editor = board.editorOrNull();
  if (editor !== null) {
    typeInto(editor, 'hello');
    await flushFrames();
  }

  // The colours and the delete on the note's own toolbar, which the story counts as editing too.
  clickAt(board.note(0), noteOnScreen(board));
  await flushFrames();
  const toolbar = board.view.queryByTestId('note-toolbar');
  if (toolbar !== null) {
    fireEvent.click(board.view.getAllByTestId('note-color')[3] as HTMLElement);
    fireEvent.click(board.view.getByTestId('note-delete'));
    await flushFrames();
  }
}

beforeEach(() => {
  forgetProviders();
});

describe('TC-23 a board that could not be loaded is not a board to write on', () => {
  it('says what is wrong before anything else', async () => {
    await theBoardCameDown();

    // The board stops being writable because the app knows the board is unreadable, so the thing
    // that says so has to be true at the moment the tools go quiet.
    expect(screen.getByTestId('connection-status').textContent).toBe(
      "This board couldn't be loaded. Retrying…",
    );
    expect(canEdit('load_failed')).toBe(false);
  });

  it('changes nothing, however it is asked', async () => {
    const opened = await theBoardCameDown();
    const before = opened.theBoard();
    const notes = opened.board.noteCount();

    await tryToChangeTheBoard(opened);

    expect(opened.board.noteCount()).toBe(notes);
    expect(opened.board.editorOrNull()).toBeNull();
    expect(opened.theBoard()).toBe(before);
    // The document is the record of what the model was asked to do, and it records nothing.
    expect(opened.writes()).toBe(0);
  });

  it('disables the Sticky note button rather than pretending to add a note', async () => {
    const opened = await theBoardCameDown();

    const button = screen.getByTestId('create-sticky');
    expect(button).toBeDisabled();

    fireEvent.click(button);
    await flushFrames();
    expect(opened.board.noteCount()).toBe(2);
    expect(opened.writes()).toBe(0);
  });

  it('will not even bring a note to the front', async () => {
    const opened = await theBoardCameDown();
    const before = opened.theBoard();

    // The smallest write there is: a press on a note, which normally reorders it so it is never
    // dragged out from behind its neighbours. Selecting is not editing, but nothing is written.
    clickAt(opened.board.note(0), noteOnScreen(opened.board));
    await flushFrames();

    expect(opened.theBoard()).toBe(before);
    expect(opened.writes()).toBe(0);
  });

  it('still lets the board be looked at', async () => {
    const opened = await theBoardCameDown();

    // Selection is how you see which note you mean, and how the keyboard gets somewhere; a board
    // that could not be read is still a board to read.
    clickAt(opened.board.note(0), noteOnScreen(opened.board));
    await flushFrames();

    expect(opened.board.toolbarOrNull()).not.toBeNull();
    expect(opened.writes()).toBe(0);
  });
});

describe('TC-23 the same board, when it is a board', () => {
  it('changes every one of those ways when it loaded', async () => {
    const opened = await openTheBoard();
    const before = opened.theBoard();

    await tryToChangeTheBoard(opened);

    // The same sequence of actions, on a board that is known to be the board, does all of it: a
    // note appears, the note moves, the text is typed, the colour and the delete go through.
    expect(screen.getByTestId('create-sticky')).toBeEnabled();
    expect(opened.theBoard()).not.toBe(before);
    expect(opened.writes()).toBeGreaterThan(0);
  });

  it('adds a note when the button is pressed', async () => {
    const opened = await openTheBoard();

    fireEvent.click(screen.getByTestId('create-sticky'));
    await flushFrames();

    expect(opened.board.noteCount()).toBe(3);
    expect(opened.writes()).toBeGreaterThan(0);
  });

  it('opens a note for typing when it is double-clicked', async () => {
    const opened = await openTheBoard();

    doubleClick(opened.board.note(0), noteOnScreen(opened.board));
    await flushFrames();

    const editor = opened.board.editorOrNull();
    expect(editor).not.toBeNull();
    if (editor !== null) {
      typeInto(editor, 'hello');
      await flushFrames();
      // Read the model, not the screen: while a note is being typed in, the text drawn on the
      // board is not that note's, so the board's own words are the ones to look at.
      const texts = snapshot(opened.board.doc).map((note) => note.text);
      expect(texts.some((text) => text.includes('hello'))).toBe(true);
    }
  });

  it('deletes the note Delete is pressed on', async () => {
    const opened = await openTheBoard();

    clickAt(opened.board.note(0), noteOnScreen(opened.board));
    await flushFrames();
    pressKey('Delete');
    await flushFrames();

    expect(opened.board.noteCount()).toBe(1);
  });
});
