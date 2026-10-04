import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { flushFrames } from './helpers';
import { mountSticky, type MountedSticky } from './helpers/sticky';
import {
  chooseTextSize,
  chooseTool,
  countUpdates,
  endEditing,
  placeText,
  pressOn,
  remoteChange,
  textEditor,
  typeText,
  watchBoxWrites,
  type BoxWrites,
} from './helpers/text';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { remeasureTextBox } from '../../src/client/objects/useTextBoxSync';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import type { Measurer } from '../../src/client/objects/textLayout';

/**
 * Who measures the box around the words (TC-12, TC-13).
 *
 * The box a piece of text occupies is stored in the document, so that nine people looking at a board
 * do not have to agree about how wide a letter is in order to look at it. Someone has to measure it,
 * and the story's answer is: the person who changed the text. Not because measuring is expensive -
 * it is nearly free - but because a client that measures on its own initiative writes a width into
 * somebody else's object, and on a board where two machines measure a font two per cent differently
 * that is a write that never stops.
 *
 * So the claim under test is about *writes*, and it is a claim in both directions: after a change
 * that came from this keyboard there is exactly one, and after a change that came from anywhere else
 * there is none. What the screen draws cannot tell those two apart, so every test here counts what
 * the document was asked to store.
 */

/** Everything a test needs to watch one object's box, and to know when to stop. */
interface Watching {
  board: MountedSticky;
  id: string;
  box: BoxWrites;
  updates: ReturnType<typeof countUpdates>;
  stop(): void;
}

async function aTextBeingTypedIn(): Promise<Watching> {
  const board = await mountSticky();
  await chooseTool(board, 'text');
  const id = await placeText(board, { x: 120, y: 60 });
  const watching: Watching = {
    board,
    id,
    box: watchBoxWrites(board, id),
    updates: countUpdates(board),
    stop: () => {
      watching.box.stop();
      watching.updates.stop();
    },
  };
  return watching;
}

describe('text.layout: the box is written by the client that changed the text (TC-12)', () => {
  it('TC-12: a change that arrives from another screen writes no box', async () => {
    const { board, id, box, updates, stop } = await aTextBeingTypedIn();
    // The object is being typed into, and it is the box it was made with: no text has been measured
    // into it yet.
    expect(board.object(id).width).toBe(40);
    box.reset();
    updates.reset();

    // Another screen puts a long sentence into the same text. It is a peer's write, told apart by
    // the origin of the transaction, which is the only way this client can tell.
    remoteChange(board, () => {
      getTextContent(board.doc, id)?.insert(0, 'a great many words from somewhere else entirely');
    });
    await flushFrames();

    // The words arrived, and nothing else did: the box is what the other client stored, whatever
    // this machine thinks the width of a letter is.
    expect(board.object(id).text).toBe('a great many words from somewhere else entirely');
    expect(box.keys()).toEqual([]);
    // Not one update out of this client either - not even one that would have written the same
    // numbers back. An update is what everybody else on the board would have to hear about.
    expect(updates.count()).toBe(0);
    stop();
  });

  it('TC-12b: and the box this client types into is measured, once, here', async () => {
    const { board, id, box, stop } = await aTextBeingTypedIn();
    const editor = textEditor(board);

    typeText(board, 'Went well');
    await flushFrames();

    // One box write for one change of text: the nine letters are measured at the size the object is
    // drawn at, and the numbers stored are the numbers the measurement came to. In this environment
    // there is no canvas to measure with, so the estimate stands in - which is the fallback the
    // layout tests cover; what matters here is that the write happened, once, from this client.
    expect(box.keys()).toEqual(['width=90', 'height=26']);
    expect(board.object(id).width).toBe(90);
    expect(board.object(id).height).toBe(26);
    // The typed text is the text in the document: measuring never ate a keystroke.
    expect(editor.value).toBe('Went well');
    stop();
  });

  it('TC-12c: a second change is measured again, and nothing else is written', async () => {
    const { board, id, box, updates, stop } = await aTextBeingTypedIn();

    typeText(board, 'Went');
    await flushFrames();
    box.reset();
    updates.reset();

    typeText(board, ' well');
    await flushFrames();

    // One more box, and one more box only: the text and the room it needs are the whole of what a
    // keystroke costs, and they cost it together. One update per letter rather than two is the
    // difference between a board that keeps up with five people typing and one that does not, and it
    // means nobody ever sees the new letters inside the old box.
    expect(box.transactions()).toBe(1);
    expect(updates.count()).toBe(1);
    expect(board.object(id).text).toBe('Went well');
    stop();
  });

  it('TC-12d: a paste is measured the same way a keystroke is', async () => {
    const { board, id, box, stop } = await aTextBeingTypedIn();
    box.reset();

    // A paste arrives as one change event with the whole value in it.
    fireEvent.change(textEditor(board), { target: { value: 'Pasted in one go' } });
    await flushFrames();

    expect(board.object(id).text).toBe('Pasted in one go');
    // Measured once, at sixteen letters wide: the estimate is what a browser's measurement stands in
    // for here, and one write per change either way.
    expect(box.keys().length).toBe(2);
    expect(board.object(id).width).toBe(160);
    stop();
  });
});

describe('text.layout: a box that did not change is not written (TC-13)', () => {
  it('TC-13: choosing the size the text is already at writes nothing at all', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    const id = await placeText(board);
    typeText(board, 'Went well');
    await flushFrames();
    // Selected, so the size buttons are on screen; and the size they press is the size it is.
    await endEditing(board);
    await pressOn(board, id);
    const updates = countUpdates(board);
    const box = watchBoxWrites(board, id);

    await chooseTextSize(board, 'M');

    // The model refuses a size the object already has, so there is no measurement to make and no
    // box to store. A board that wrote the same numbers again on every mis-click would be a board
    // that tells nine other screens about nothing, forever.
    expect(updates.count()).toBe(0);
    expect(box.keys()).toEqual([]);
    expect(board.object(id)).toMatchObject({ size: 'M', width: 90, height: 26 });
    updates.stop();
    box.stop();
  });

  it('TC-13b: a measurement that comes out the box the object already has writes nothing', async () => {
    const board = await mountSticky();
    const id = createText(board.doc, { x: 0, y: 0 }, 'me');
    if (id === null) {
      throw new Error('the text object was not created');
    }
    getTextContent(board.doc, id)?.insert(0, 'Went well');
    // A measurer that does not care what it is asked: every string, at every size, is ninety wide.
    // This is the case the code cannot argue its way out of - the measurement is real, and it comes
    // out as the box that is already stored.
    const alwaysNinety: Measurer = () => 90;
    expect(remeasureTextBox(board.doc, id, alwaysNinety)).toBe(true);
    expect(board.object(id)).toMatchObject({ size: 'M', width: 90, height: 26 });
    const box = watchBoxWrites(board, id);
    const updates = countUpdates(board);

    // Measure again. A resize gesture does exactly this on every frame it is underway - sixty times
    // a second, on a board where the words may not have moved at all - so the frames that changed
    // nothing must be silent, or a drag of two seconds would put a hundred and twenty updates in
    // front of everybody else to say the text is the size it was.
    const wrote = remeasureTextBox(board.doc, id, alwaysNinety);
    box.stop();
    updates.stop();

    expect(wrote).toBe(false);
    expect(box.keys()).toEqual([]);
    expect(updates.count()).toBe(0);
  });

  it('TC-13c: but a size change that needs more room gets it, in one step', async () => {
    const board = await mountSticky();
    await chooseTool(board, 'text');
    const id = await placeText(board);
    typeText(board, 'Went well');
    await flushFrames();
    await endEditing(board);
    await pressOn(board, id);
    const box = watchBoxWrites(board, id);

    await chooseTextSize(board, 'XL');

    // Bigger letters at the same width in auto mode: the line is still one line, so the height is
    // the number that grew, and it grew to what the size says a line is - not to a number this test
    // made up.
    expect(board.object(id).size).toBe('XL');
    expect(board.object(id).height).toBe(Math.round(TEXT_SIZES.XL * TEXT_LINE_HEIGHT));
    expect(box.keys()).toEqual(['width=252', 'height=73']);
    box.stop();
  });
});
