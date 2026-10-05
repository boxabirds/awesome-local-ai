/**
 * The board's two tools, and the keys that move between them (story 9, TC-14 to TC-18).
 *
 * The tool is a mode, and modes are only acceptable when they are visible and escapable, which is what these
 * tests are about: that arming the text tool is something a person can see in the toolbar, undo with a key
 * that does not also do something else, and cannot fall into by accident while typing. The four questions
 * the design asks of it are these four tests, and each is a failure mode of a mode:
 *
 *   - a tool that cannot be left is a trap (TC-14);
 *   - a tool that works on a board that cannot be written to is a promise the board will not keep (TC-15);
 *   - a shortcut that fires while somebody is typing steals a letter (TC-16);
 *   - a placement that lands somewhere other than where the person clicked is worse than no placement
 *     (TC-17).
 *
 * TC-18 is the regression the whole feature risks: the board had one creation shortcut story and it still
 * has it.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';

import {
  BOARD_ID,
  addText,
  boardExists,
  camera,
  centreWorld,
  clickBoardToText,
  doc,
  drawnText,
  hasTextarea,
  hasTextTextarea,
  measureWithFakeFont,
  noteId,
  pressedTool,
  pasteIntoText,
  pressSelectKey,
  pressText,
  pressTextKey,
  renderBoard,
  screenToWorld,
  somebodyElse,
  somebodyTypesInto,
  stickies,
  surface,
  textById,
  textarea,
  textElementById,
  texts,
  textTextarea,
  textToolArmed,
  typeIntoText,
  upWindow,
} from './helpers/textBoard';
import { BoardPage } from '../../src/client/pages/BoardPage';
import type { BoardConnector } from '../../src/client/board/useBoardDoc';
import { createSticky } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';

/** A board whose document could not be loaded: it shows what is there and writes nothing. */
const loadFailed: BoardConnector = (_doc, _boardId, onState) => {
  onState('load_failed');
  return { destroy(): void {} };
};

function renderLoadFailedBoard(): void {
  render(<BoardPage id={BOARD_ID} connect={loadFailed} check={boardExists} />);
}

describe('board tools', () => {
  measureWithFakeFont();

  it('TC-14: T arms the text tool, and both Escape and V put it down again', () => {
    renderBoard();

    expect(pressedTool()).toBe('Select (V)');
    expect(textToolArmed()).toBe(false);

    pressTextKey();
    expect(textToolArmed()).toBe(true);
    expect(pressedTool()).toBe('Text (T)');

    // Escape steps out of the tool, and does nothing else. The board's own Escape — clear the selection —
    // is listening on the same window, and a keypress that did both would take a person's selection away
    // at the exact moment they were backing out of a tool they did not mean to be in.
    pressTextKey();
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(textToolArmed()).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(textToolArmed()).toBe(false);
    expect(pressedTool()).toBe('Select (V)');

    // V is the other way out, for a person on the keyboard already.
    pressTextKey();
    expect(textToolArmed()).toBe(true);
    pressSelectKey();
    expect(textToolArmed()).toBe(false);
    expect(pressedTool()).toBe('Select (V)');
  });

  it("TC-14b: the toolbar's two buttons arm and disarm the same tool the keys do", async () => {
    renderBoard();

    fireEvent.click(screen.getByTestId('tool-text'));
    expect(textToolArmed()).toBe(true);

    // The button reports itself pressed, which is the only way a person who cannot see the cursor can tell
    // which tool they are in without clicking something to find out.
    expect(screen.getByTestId('tool-text').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('false');

    // A key that is not the toolbar's: the tool is one thing, and the two ways into it had better agree.
    pressSelectKey();
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');

    // And a click on the board with the tool armed makes exactly one piece of text before the tool lets go.
    fireEvent.click(screen.getByTestId('tool-text'));
    const id = await clickBoardToText({ x: 320, y: 220 });
    expect(id).toBeTruthy();
    await waitFor(() => expect(textToolArmed()).toBe(false));
  });

  it('TC-15: on a board that could not be loaded the text tool is out of use, in both ways in', async () => {
    renderLoadFailedBoard();
    await waitFor(() => expect(screen.queryByTestId('toolbar')).toBeTruthy());

    // The button says it: disabled, and named as such.
    const button = screen.getByTestId('tool-text');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // Clicking it is not prevented and does nothing: the key and the button are the same command, and a
    // board that cannot be written to refuses it from both hands.
    fireEvent.click(button);
    expect(textToolArmed()).toBe(false);

    pressTextKey();
    expect(textToolArmed()).toBe(false);

    // And clicking the board, however it got there, creates nothing in a document that is about to be
    // thrown away.
    const before = doc().getMap('objects').size;
    pointerDownAndUp({ x: 300, y: 200 });
    expect(doc().getMap('objects').size).toBe(before);
  });

  it('TC-16: T typed into a note is a letter and not a tool change', async () => {
    renderBoard();
    // A note, open for typing.
    await placeNoteAndEdit();

    const editor = textarea();
    // The keystroke is given to the editor, as the browser gives it to a field: `fireEvent` reports false
    // only when somebody called preventDefault, and nobody working on a text tool should be doing that to
    // a letter somebody is typing.
    expect(fireEvent.keyDown(editor, { key: 't' })).toBe(true);
    editor.value = 't';
    fireEvent.input(editor);

    // The tool did not move, and the letter is in the note.
    expect(textToolArmed()).toBe(false);
    expect(pressedTool()).toBe('Select (V)');
    expect(stickies()[0].text).toBe('t');
  });

  it('TC-16b: the same letter typed into a piece of text is still a letter', async () => {
    renderBoard();
    // A piece of text made by a colleague and opened with the keyboard: the text tool is nowhere near this.
    const id = addText({ x: 400, y: 300 });
    pressText(id);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(hasTextTextarea()).toBe(true));

    // Not prevented: a letter belongs to the text, and an armed tool is not even in the running.
    expect(fireEvent.keyDown(textTextarea(), { key: 't' })).toBe(true);
    pasteIntoText('t');
    await waitFor(() => expect(textById(id).text).toBe('t'));
    expect(textToolArmed()).toBe(false);

    fireEvent.keyDown(textTextarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextTextarea()).toBe(false));
    expect(drawnText(id)).toBe('t');
  });

  it('TC-16c: Escape from inside a text object leaves the words and steps out of the tool', async () => {
    renderBoard();
    const id = addText({ x: 400, y: 300 });
    // A text that has words in it is not the same question as an empty one: the words have to survive the
    // key that means "I am done".
    somebodyTypesInto(id, 'kept');

    pressTextKey();
    pressText(id);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(hasTextTextarea()).toBe(true));

    fireEvent.keyDown(textTextarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextTextarea()).toBe(false));

    // Out of the editor and out of the tool, with the words left behind: two different things given the
    // same key, and neither of them allowed to eat what was written.
    expect(textToolArmed()).toBe(false);
    expect(drawnText(id)).toBe('kept');
  });

  it('TC-17: a click on the board with the text armed puts text at that point and opens it for typing', async () => {
    renderBoard();
    const at = { x: 340, y: 210 };

    pressTextKey();
    const id = await clickBoardToText(at);

    // The world point that was clicked is the top-left corner of the new text — the point looked at, not
    // the middle of the object, which is what a sticky note does and would be wrong here: a person places
    // the first letter of a heading, not the middle of a heading they have not written yet.
    const placed = screenToWorld(camera(), at);
    const text = textById(id);
    expect(text.type).toBe('text');
    expect(text.x).toBeCloseTo(placed.x, 6);
    expect(text.y).toBeCloseTo(placed.y, 6);
    expect(text.createdBy).toBe(String(doc().clientID));

    // The tool stepped aside on its own, and the text is open for typing and selected.
    expect(textToolArmed()).toBe(false);
    expect(hasTextTextarea()).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId('text-textarea'));
    expect(textElementById(id).dataset.selected).toBe('true');
  });

  it('TC-17b: the tool places one thing and stops, so a second click is an ordinary click', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText({ x: 300, y: 200 });
    typeIntoText('one');

    // The tool is gone, so this second click is an ordinary click on the board: it selects nothing and,
    // above all, does not make a second piece of text. A mode that stayed armed would turn every click
    // into a text object and fill a board with invisible nothing.
    pointerDownAndUp({ x: 600, y: 400 });
    await waitFor(() => expect(hasTextTextarea()).toBe(false));
    expect(texts().map((text) => text.id)).toEqual([id]);
    expect(textToolArmed()).toBe(false);
  });

  it('TC-17c: a text object is placed where the board is looking, not at the origin', async () => {
    renderBoard();
    const far = { x: 4000, y: 3000, zoom: 1 };
    window.__vidi6?.setCamera(far);
    await waitFor(() => expect(camera()).toEqual(far));

    pressTextKey();
    const id = await clickBoardToText({ x: 400, y: 300 });

    expect(textById(id).x).toBeGreaterThan(4000);
    expect(textById(id).y).toBeGreaterThan(3000);
  });

  it('TC-18: N still puts a sticky note in the middle of what is on screen', async () => {
    renderBoard();

    expect(fireEvent.keyDown(window, { key: 'n' })).toBe(false);

    await waitFor(() => expect(stickies()).toHaveLength(1));
    const centre = centreWorld();
    expect(stickies()[0].type).toBe('sticky');
    expect(stickies()[0].x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(stickies()[0].y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    // Straight into typing, exactly as the toolbar button puts it.
    expect(hasTextarea()).toBe(true);
    expect(document.activeElement).toBe(textarea());
  });

  it('TC-18b: N is the same command as the toolbar button, and does not arm the text tool', async () => {
    renderBoard();
    fireEvent.keyDown(window, { key: 'n' });
    await waitFor(() => expect(hasTextarea()).toBe(true));
    expect(textToolArmed()).toBe(false);

    // The same place the button would have put it, which is the only thing that makes one command out of
    // two ways of giving it.
    const fromKeyboard = { ...stickies()[0] };
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('create-sticky'));
    await waitFor(() => expect(stickies()).toHaveLength(2));

    expect(stickies()[1].x).toBe(fromKeyboard.x);
    expect(stickies()[1].y).toBe(fromKeyboard.y);
  });

  it('N is ignored where the letters belong to somebody else', async () => {
    renderBoard();
    // The share panel's link field is a field the board drew but does not write to.
    fireEvent.click(screen.getByTestId('share-button'));
    const link = screen.getByTestId('share-link') as HTMLInputElement;
    link.focus();

    // Not prevented: the browser's own typing inside a field needs the key.
    expect(fireEvent.keyDown(link, { key: 'n' })).toBe(true);
    expect(stickies()).toHaveLength(0);
  });

  it('N does not create on a board that could not be loaded', async () => {
    renderLoadFailedBoard();
    await waitFor(() => expect(screen.getByTestId('tool-text').hasAttribute('disabled')).toBe(true));

    somebodyElse((there) => {
      createSticky(there, { x: 200, y: 200 });
    });
    await waitFor(() => expect(stickies()).toHaveLength(1));

    // Nothing is created, in a document that is about to be thrown away.
    fireEvent.keyDown(window, { key: 'n' });
    expect(stickies()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ local helpers -- */

// These four are local rather than in `helpers/textBoard.ts` for one reason: the two `placeNote` helpers
// create a note by double-clicking the board, which is the same gesture that TC-17 is about, and a helper
// that quietly depends on the thing under test makes a passing test mean less.
function pointerDownAndUp(at: Point): void {
  fireEvent.pointerDown(surface(), { clientX: at.x, clientY: at.y, button: 0, pointerId: 1 });
  upWindow(at);
}

/** A note made by the toolbar button, open for typing. */
async function placeNoteAndEdit(): Promise<string> {
  fireEvent.click(screen.getByTestId('create-sticky'));
  await waitFor(() => expect(hasTextarea()).toBe(true));
  return noteId();
}
