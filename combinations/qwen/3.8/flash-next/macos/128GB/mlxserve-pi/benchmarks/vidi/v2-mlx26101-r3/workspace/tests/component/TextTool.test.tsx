import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { flushFrames, VIEWPORT } from './helpers';
import {
  clickAt,
  doubleClick,
  mountSticky,
  press,
  pressCombo,
  pressKey,
  pressKeyIn,
  release,
  typeInto,
  viewCentreWorld,
} from './helpers/sticky';
import {
  chooseTool,
  dragOnBoard,
  endEditing,
  placeText,
  textEditor,
  textEditorOrNull,
  textElements,
  toolButton,
  toolPressed,
  toolState,
  typeText,
  worldAt,
} from './helpers/text';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { forgetProviders, theProvider } from './helpers/fake-provider';

// The client's provider is stubbed so a close code can be handed to it: one test below asks what the
// Text tool does on a board that is not known to be a board, and that state is only reachable by
// being told the room could not read it.
vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/**
 * The Text tool (TC-14 to TC-18): which tool the board is in, and what a click on the board means
 * once it is in the other one.
 *
 * A tool is a promise about the next click. That is the whole of what these tests are about, which is
 * why they are mostly about a piece of state no test can see on the board itself - `data-tool` on the
 * surface, and the pressed state of the button - and about the one thing the tool exists to do: put a
 * text object under the pointer, ready to be typed into, and get out of the way afterwards.
 *
 * The negative half matters as much as the positive: a board that could not be loaded has no Text
 * tool, and a board that is being typed into takes no keys. A tool button that lights up on a board
 * where nothing can be written is a button that lies, and a letter that changes a tool while somebody
 * is typing it is a letter that never arrived.
 */

beforeEach(() => {
  forgetProviders();
});

describe('text.tool_ui: the tool that is up (TC-14)', () => {
  it('TC-14: T puts the Text tool up, Escape takes it back, V does too', async () => {
    const board = await mountSticky();

    expect(toolState(board)).toBe('select');
    expect(toolPressed(board, 'select')).toBe(true);

    expect(pressCombo('KeyT')).toBe(true);
    await flushFrames();

    expect(toolState(board)).toBe('text');
    expect(toolPressed(board, 'text')).toBe(true);
    expect(toolPressed(board, 'select')).toBe(false);

    // Escape is the way out of a thing that has not been done yet.
    pressKey('Escape');
    await flushFrames();
    expect(toolState(board)).toBe('select');
    expect(toolPressed(board, 'select')).toBe(true);

    // And the key that names the tool does the same thing as Escape.
    pressCombo('KeyT');
    await flushFrames();
    expect(toolState(board)).toBe('text');
    pressCombo('KeyV');
    await flushFrames();
    expect(toolState(board)).toBe('select');
  });

  it('TC-14b: the toolbar button puts the tool up, and pressing it again keeps it up', async () => {
    const board = await mountSticky();

    await chooseTool(board, 'text');
    expect(toolState(board)).toBe('text');

    // The two tool buttons are not a toggle each: pressing the tool that is already up is not how you
    // put it down, because there is no state in which "no tool" is a thing a board can be in. Escape
    // and Select are the ways out.
    await chooseTool(board, 'text');
    expect(toolState(board)).toBe('text');

    await chooseTool(board, 'select');
    expect(toolState(board)).toBe('select');
  });

  it('TC-14c: a tool is this person\'s mouse, not the board\'s business', async () => {
    const board = await mountSticky();
    const before = JSON.stringify(snapshot(board.doc));

    await chooseTool(board, 'text');

    // Nothing about a tool belongs in the document: whose pointer is what, and to nobody else. A
    // board that stored it would have nine people agree about one person's mouse, which is how the
    // selection already does not work.
    expect(JSON.stringify(snapshot(board.doc))).toBe(before);
  });
});

describe('text.tool_ui: a board that cannot be written to has no Text tool (TC-15)', () => {
  it('TC-15: the tool is disabled, and neither the key nor the button takes it', async () => {
    const board = await mountSticky(undefined, { boardId: 'b1' });
    const provider = theProvider();
    provider.socketOpens();
    provider.sync();
    await flushFrames();

    // The board loaded, so the tool is available: the negative below only means something if the
    // same test on a board that could not be loaded behaves the other way.
    expect(toolButton(board, 'text')).toBeEnabled();
    pressCombo('KeyT');
    await flushFrames();
    expect(toolState(board)).toBe('text');
    // Back to Select, and then take the board away.
    pressCombo('KeyV');
    await flushFrames();

    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    await flushFrames();

    // The button says it is not there to be used.
    expect(toolButton(board, 'text')).toBeDisabled();

    // And it is not: a click on a disabled button does nothing in a browser, so the click is fired
    // directly to test the handler behind it as well as the button.
    fireEvent.click(toolButton(board, 'text'));
    await flushFrames();
    expect(toolState(board)).toBe('select');

    // The key is left to the browser rather than being taken and dropped on the floor.
    expect(pressCombo('KeyT')).toBe(false);
    await flushFrames();
    expect(toolState(board)).toBe('select');

    // And a text object cannot be conjured by clicking where the tool would have put one.
    clickAt(board.board, { x: 400, y: 300 });
    await flushFrames();
    expect(textElements(board)).toHaveLength(0);
  });

  it('TC-15b: a tool that was up when the board came down is dropped with it', async () => {
    const board = await mountSticky(undefined, { boardId: 'b1' });
    const provider = theProvider();
    provider.socketOpens();
    provider.sync();
    await flushFrames();

    await chooseTool(board, 'text');
    expect(toolState(board)).toBe('text');

    // The board went away while the tool was up. A pressed button that clicks do nothing to is a
    // lie about the state of the board, so the tool follows the board rather than the other way.
    provider.roomClosesWith(CLOSE_BOARD_LOAD_FAILED);
    await flushFrames();

    expect(toolState(board)).toBe('select');
    expect(toolPressed(board, 'text')).toBe(false);
    expect(toolPressed(board, 'select')).toBe(true);
  });
});

describe('text.tool_ui: typing is not commanding (TC-16)', () => {
  it('TC-16: T typed into a note is a letter, not a tool', async () => {
    const board = await mountSticky();
    const id = createSticky(board.doc, { x: 40, y: 40 });
    await flushFrames();

    clickAt(board.note(), board.screenOf({ x: 40 + STICKY_SIZE_WORLD / 2, y: 40 + STICKY_SIZE_WORLD / 2 }));
    await flushFrames();
    pressKey('Enter');
    await flushFrames();

    const editor = board.editor();
    expect(editor).toBe(document.activeElement);

    // The letter is typed where the keyboard is: into the note.
    typeInto(editor, 'at');
    await flushFrames();

    // ...and the tool did not move: a board that changed tools in the middle of a word would be a
    // board that lost the letter that asked for it.
    expect(toolState(board)).toBe('select');
    expect(toolPressed(board, 'text')).toBe(false);
    // The letters are in the note, because nothing intercepted them.
    expect(board.object(id).text).toBe('at');
  });

  it('TC-16b: T typed into a text object is a letter too', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    const id = await placeText(board);

    fireEvent.change(textEditor(board), { target: { value: 'ater' } });
    await flushFrames();

    expect(toolState(board)).toBe('select');
    expect(board.object(id).text).toBe('ater');
  });

  it('TC-16c: V and N are left alone while a field has the keyboard', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    const id = await placeText(board);
    const editor = textEditor(board);

    // Nothing is taken from a field: not the key, and so not the browser's own behaviour either.
    expect(pressKeyIn(editor, 'v')).toBe(false);
    expect(pressKeyIn(editor, 'n')).toBe(false);
    await flushFrames();

    expect(toolState(board)).toBe('select');
    expect(board.noteCount()).toBe(0);
    expect(board.object(id).text).toBe('');
  });
});

describe('text.tool_ui: a click with the Text tool up (TC-17)', () => {
  it('TC-17: a text object appears under the pointer, ready to type into, and the tool is over', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');

    const screen = board.screenOf({ x: 300, y: 200 });
    await placeText(board, { x: 300, y: 200 });
    // The board asked for the world point the pointer was over, and made the object there: the same
    // point the double-click that makes a note uses, which is the whole trick of the tool.
    expect(worldAt(board, screen)).toEqual({ x: 300, y: 200 });

    const objects = snapshot(board.doc);
    expect(objects).toHaveLength(1);
    const made = board.object(objects[0]!.id);
    expect(made.type).toBe('text');
    expect(made).toMatchObject({ x: 300, y: 200, width: 40, height: 26, size: 'M', widthMode: 'auto' });

    // It is the object under the pointer, at the top of the pile, and it is selected.
    expect(board.element(made.id).dataset.selected).toBe('true');
    // Typing starts without a second click, which is the whole point of the tool.
    const editor = textEditorOrNull(board);
    expect(editor).not.toBeNull();
    expect(editor).toBe(document.activeElement);
    // ...and the tool is done with: the next click selects and moves, as it always did.
    expect(toolState(board)).toBe('select');
    expect(board.noteCount()).toBe(0);
  });

  it('TC-17b: the new object is drawn where the document says it is', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    const id = await placeText(board, { x: -200, y: -100 });

    const element = board.element(id);
    expect(element.style.left).toBe('-200px');
    expect(element.style.top).toBe('-100px');
    expect(element.dataset.objectType).toBe('text');
    expect(element.dataset.textSize).toBe('M');
    expect(element.dataset.widthMode).toBe('auto');
  });

  it('TC-17c: a press that travels is not a place, and nothing is written', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');

    // A press and a release a long way apart is a drag; with the Text tool up there is nothing for a
    // drag to do, so it does nothing - rather than panning, marquee-ing, or placing a text object the
    // person never meant to let go of at the end of the movement.
    await dragOnBoard(board, { x: 200, y: 200 }, { x: 700, y: 500 });

    expect(textElements(board)).toHaveLength(0);
    expect(board.marqueeOrNull()).toBeNull();
    // The tool is still up, because nothing happened that could have finished it.
    expect(toolState(board)).toBe('text');
  });

  it('TC-17d: a double-click with the tool up makes one text object, not a note as well', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');

    // A double-click is two clicks, and the board's double-click has always meant "a sticky note
    // here". The first click of this pair put a text object under the pointer; the second half lands
    // on that object, which is where the pointer now is. Neither half may make a note: one gesture
    // that made a text object and a note would be a gesture that made something else.
    const id = await placeText(board, { x: 300, y: 200 });
    const element = board.element(id);
    const screen = board.screenOf({ x: 310, y: 210 });
    press(element, screen);
    release(element, screen);
    fireEvent.doubleClick(element, screen);
    await flushFrames();

    expect(board.noteCount()).toBe(0);
    expect(textElements(board)).toHaveLength(1);
  });

  it('TC-17e: and while the tool is still up, a double-click on the bare board makes no note either', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    // Nothing was placed, because the press travelled - so the Text tool is still the tool that is up.
    await dragOnBoard(board, { x: 200, y: 200 }, { x: 700, y: 500 });
    expect(toolState(board)).toBe('text');

    // The board's double-click is taken in the capture phase, before anything else gets to see it,
    // because a tool that is up has to be believed: the note would otherwise be made by a handler that
    // only ever fires on empty board and cannot be reached from the tool at all.
    fireEvent.doubleClick(board.board, board.screenOf({ x: 400, y: 300 }));
    await flushFrames();

    expect(board.noteCount()).toBe(0);
    expect(textElements(board)).toHaveLength(0);
    expect(toolState(board)).toBe('text');

    // The same double-click with the tool back down is the old gesture again - which is what says the
    // test above measured the tool and not something that was never going to happen.
    await chooseTool(board, 'select');
    fireEvent.doubleClick(board.board, board.screenOf({ x: 400, y: 300 }));
    await flushFrames();

    expect(board.noteCount()).toBe(1);
  });

  it('TC-17f: a press on the toolbar is still a press on the toolbar', async () => {
    const board = await mountSticky();
    const toolbar = board.view.container.querySelector<HTMLElement>('[data-testid="board-toolbar"]');
    if (toolbar === null) {
      throw new Error('the board toolbar is missing');
    }
    await chooseTool(board, 'text');

    // The tool is up; a press on the bar that says which tool is up changes the tool, and does not
    // write a text object behind the bar.
    press(toolbar, { x: 20, y: 20 });
    release(toolbar, { x: 20, y: 20 });
    await flushFrames();

    expect(textElements(board)).toHaveLength(0);
    expect(toolState(board)).toBe('text');
  });
});

describe('text.tool_ui: the sticky note button is still there (TC-18)', () => {
  it('TC-18: N makes a note in the middle of the view, as it always did', async () => {
    const board = await mountSticky();

    expect(pressCombo('KeyN')).toBe(true);
    await flushFrames();

    expect(board.noteCount()).toBe(1);
    const note = board.object(board.notes()[0]!.id);
    const centre = viewCentreWorld(board);
    expect({ x: note.x + note.width / 2, y: note.y + note.height / 2 }).toEqual(centre);
    // And it is ready to type in, which is what N was always for.
    expect(board.editorOrNull()).not.toBeNull();
  });

  it('TC-18b: N still works after the Text tool has been used', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    const id = await placeText(board, { x: 100, y: 100 });
    typeText(board, 'Went well');
    // Out of the typing first: while a field has the keyboard, no single key is a command - which is
    // the subject of TC-16, and is why this test has to let go of the text before it can make a note.
    await endEditing(board);

    pressCombo('KeyN');
    await flushFrames();

    // Two kinds of object on the board, each made by the key that names it.
    expect(board.noteCount()).toBe(1);
    expect(textElements(board)).toHaveLength(1);
    expect(board.object(id).type).toBe('text');
    expect(board.object(id).text).toBe('Went well');
    // The note took the tool back with it: N means "a note, now", not "a note in place of the tool".
    expect(toolState(board)).toBe('select');
    expect(board.editorOrNull()).not.toBeNull();
  });

  it('TC-18c: the double-click that makes notes still makes notes when the tool is back down', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    await chooseTool(board, 'select');

    doubleClick(board.board, { x: 400, y: 300 });
    await flushFrames();

    expect(board.noteCount()).toBe(1);
    expect(textElements(board)).toHaveLength(0);
    expect(board.note().style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(VIEWPORT.width).toBe(1280);
  });
});

