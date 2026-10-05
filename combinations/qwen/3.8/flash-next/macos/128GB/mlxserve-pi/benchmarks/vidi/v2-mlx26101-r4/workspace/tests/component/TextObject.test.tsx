/**
 * One piece of free text on the board: typing in it, sizing it, selecting it, undoes (story 9, TC-19-TC-25).
 *
 * These tests are about the difference between this object and a sticky note, which is one field and a lot
 * of consequences: a note's box is a thing a person drags, and this object's box is a consequence of its
 * words. So almost every test here says something about both at once — the words, and the box the words
 * made — and a test that looked only at the words would pass on an implementation that never resized
 * anything.
 *
 * Measurements come from the fixture font (`helpers/textBoard.ts`), which is half a font size per character
 * on any machine. Without it these assertions would be about a font the machine may not have, which is how a
 * test suite starts failing on somebody else's laptop.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  TEXT_BOX_PADDING,
  addText,
  clickBoardToText,
  drawnText,
  fakeBox,
  fakeLineWidth,
  handleNames,
  hasTextTextarea,
  measureWithFakeFont,
  outlinedIds,
  pressSelectKey,
  pressText,
  pressTextKey,
  pasteIntoText,
  placeText,
  somebodyDeletes,
  somebodyTypesInto,
  stickies,
  surface,
  textById,
  textContent,
  textElementById,
  textTextarea,
  texts,
  typeIntoText,
  upWindow,
} from './helpers/textBoard';
import {
  MIDDLE,
  deleteSelectionButton,
  dragHandle,
  noteToolbarVisible,
  objectById,
  placeNote,
  pressEscape,
  selectAll,
  selectionBarVisible,
} from './helpers/selection';
import { renderBoard } from './helpers/stickyBoard';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

measureWithFakeFont();

/** The width the fixture font gives `characters` letters of a heading at `size`, box included. */
function widthAt(characters: number, size: keyof typeof TEXT_SIZES): number {
  return characters * TEXT_SIZES[size] * 0.5 + TEXT_BOX_PADDING * 2;
}

describe('text object', () => {
  it('TC-19: typing starts at the end, Enter is a line, and Escape leaves it selected', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText({ x: 200, y: 160 });
    typeIntoText('Went well');

    // The caret is at the end of the words, which is where a person who has just clicked an object to add to
    // it wants it. A caret at the start would type into the middle of what is already there.
    const editor = textTextarea();
    expect(editor.value).toBe('Went well');
    expect(editor.selectionStart).toBe(9);
    expect(document.activeElement).toBe(editor);

    // Enter is a line, not "I am done": a heading is often two lines, and an object that ended the edit on
    // Enter would make those lines impossible to write.
    fireEvent.keyDown(textTextarea(), { key: 'Enter' });
    expect(hasTextTextarea()).toBe(true);
    typeIntoText('\nsecond line');
    expect(textById(id).text).toBe('Went well\nsecond line');

    // And the box grew a line, because that is what a second line does to a box whose height is counted.
    expect(textById(id).height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // Escape is "I am done". The editor goes, the words stay, and the object stays selected — the person who
    // has finished typing usually wants to move the thing they just typed.
    fireEvent.keyDown(textTextarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextTextarea()).toBe(false));
    expect(drawnText(id)).toBe('Went well\nsecond line');
    expect(textElementById(id).dataset.selected).toBe('true');
    expect(outlinedIds()).toEqual([id]);
  });

  it('TC-20: a piece of text nobody typed into is gone, and nothing is left selected', async () => {
    renderBoard();

    pressTextKey();
    const id = await clickBoardToText(MIDDLE);
    expect(textById(id).text).toBe('');

    fireEvent.keyDown(textTextarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextTextarea()).toBe(false));

    // Not an invisible object on the board, taking up a slot in the marquee and the undo history for the
    // rest of the day: an empty text is a click that never happened.
    expect(texts().some((text) => text.id === id)).toBe(false);
    expect(screen.queryAllByTestId('text-object')).toHaveLength(0);
    expect(outlinedIds()).toEqual([]);
    expect(selectionBarVisible()).toBe(false);
  });

  it('TC-20b: a space is a character, and a text of one is kept', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText(MIDDLE);

    typeIntoText(' ');
    fireEvent.keyDown(textTextarea(), { key: 'Escape' });
    await waitFor(() => expect(hasTextTextarea()).toBe(false));

    // This is a blank line somebody asked for — a spacer between two headings, say. "Looks unused" is not a
    // reason to delete what a person wrote: the check is for zero characters, not for whitespace.
    expect(textById(id).text).toBe(' ');
    expect(screen.queryAllByTestId('text-object')).toHaveLength(1);
  });

  it('TC-20c: a click away from an empty text takes it with it, without Escape being pressed', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText(MIDDLE);

    // Everyone clicks somewhere else when they change their mind; almost nobody presses Escape. The cleanup
    // cannot live in the Escape handler, or it would only ever happen by the less common door.
    clickBoard({ x: 120, y: 520 });

    await waitFor(() => expect(texts().some((text) => text.id === id)).toBe(false));
    expect(hasTextTextarea()).toBe(false);
  });

  it('TC-21: the toolbar offers four sizes with the current one pressed, and XL changes the letters and the box', async () => {
    renderBoard();
    const id = await placeText({ x: 150, y: 120 }, 'Went well');

    // Four buttons, and the pressed one is the size this text is. A person should be able to see the answer
    // rather than try all four and look at what happened.
    for (const name of ['S', 'M', 'L', 'XL']) {
      expect(screen.getByTestId(`text-size-${name}`)).toBeTruthy();
    }
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('false');
    expect(textById(id).size).toBe('M');

    const before = textById(id);
    fireEvent.click(screen.getByTestId('text-size-XL'));

    const after = textById(id);
    expect(after.size).toBe('XL');
    // Where it is has nothing to do with how big the letters are: a heading that jumped position when it got
    // bigger would be a heading that moves when you look at it.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // The box came with the size, in the same write. A box left at the M measurement is a box with the last
    // few letters of 'Went well' sticking out of the right-hand end of it.
    expect(after.width).toBe(widthAt(9, 'XL'));
    expect(after.height).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    // And it is drawn at that size, not merely stored that way.
    expect(textElementById(id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(textElementById(id).dataset.textSize).toBe('XL');
  });

  it('TC-21b: the size is chosen while typing too, and the caret keeps its words', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText({ x: 220, y: 180 });
    typeIntoText('Heading');

    fireEvent.click(screen.getByTestId('text-size-L'));

    // Mid-word, the button still works. Stopping, clicking away, finding the object again and then clicking
    // the button is four operations for something the person asked for in one.
    expect(textById(id).size).toBe('L');
    expect(hasTextTextarea()).toBe(true);
    expect(textTextarea().value).toBe('Heading');
    expect(textTextarea().style.fontSize).toBe(`${TEXT_SIZES.L}px`);
    expect(textById(id).width).toBe(widthAt(7, 'L'));
  });

  it('TC-22: one piece of text is selected with two handles, and they are the ones on either side', async () => {
    renderBoard();
    const id = await placeText({ x: 180, y: 140 }, 'Went well');

    // Two, not eight. The height of this object is counted in lines, so a handle that pulled it taller would
    // be an offer to do something that cannot be done: the words would fill the same lines the moment the
    // pointer let go.
    expect(handleNames()).toEqual(['e', 'w']);
    expect(screen.queryByTestId('resize-handle-n')).toBeNull();
    expect(screen.queryByTestId('resize-handle-se')).toBeNull();

    // And the two that are there do the one thing that can be done: they set the width, and the words wrap
    // inside it.
    const before = textById(id);
    dragHandle('w', -120, 0);

    const widened = textById(id);
    expect(widened.widthMode).toBe('fixed');
    expect(widened.width).toBeCloseTo(before.width + 120, 6);
    expect(widened.x).toBeCloseTo(before.x - 120, 6);
    expect(widened.height).toBe(before.height);
  });

  it('TC-23: with a note in the selection all eight handles are offered, and each object takes what it can from the drag', async () => {
    renderBoard();
    const text = await placeText({ x: 100, y: 100 }, 'Went well');
    const note = await placeNote({ x: 360, y: 300 }, 'a note');

    // Both selected: the note can be pulled taller and the text cannot, and the handles belong to the note.
    // Taking the corners away from a person resizing a note because a heading is in the way would be the
    // text's limitation made into the note's problem.
    selectAll();
    expect(handleNames().length).toBe(8);

    const before = { text: textById(text), note: objectById(note) };
    dragHandle('se', 200, 200);

    // The note took the drag as it always does: wider and taller.
    expect(objectById(note).width).toBeGreaterThan(before.note.width);
    expect(objectById(note).height).toBeGreaterThan(before.note.height);

    // The text took the width and counted its own lines. What it did not do is get taller because something
    // else did, and the letters are the size they were chosen: no drag has ever made a font size, and a text
    // that resized like a note would be a text with its letters stretched out of the alphabet.
    const after = textById(text);
    expect(after.width).toBeGreaterThan(before.text.width);
    expect(after.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(after.size).toBe('M');
    expect(textElementById(text).style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(after.widthMode).toBe('fixed');
  });

  it('TC-23b: a dragged width wraps the words and grows the box downward', async () => {
    renderBoard();
    const id = await placeText({ x: 100, y: 100 }, 'Went well today');

    // Wide enough for one line to start with, then pulled in by enough to force more than one.
    const before = textById(id);
    expect(before.height).toBe(fakeBox(16).height);

    dragHandle('e', -120, 0);

    const narrower = textById(id);
    expect(narrower.widthMode).toBe('fixed');
    expect(narrower.width).toBeLessThan(before.width);
    expect(narrower.height).toBeGreaterThan(before.height);
    // The words themselves are untouched by a resize: not one letter lost to a box that got too small.
    expect(textContent(id)).toBe('Went well today');
  });

  it('TC-24: a text deleted by somebody else while it is being typed in stops being edited, and does not come back', async () => {
    renderBoard();
    const id = await placeText({ x: 200, y: 160 }, 'Went well');

    // Open it again and type, so that the caret is in it when the object goes away.
    pressText(id);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(hasTextTextarea()).toBe(true));
    typeIntoText(' everyone');

    somebodyDeletes(id);

    // The editor is gone. It is not left open on a `Y.Text` that has no document any more, where the caret
    // would keep blinking at words that no longer exist and every keystroke would be quietly lost — which
    // is the one failure a person cannot be left to notice for themselves.
    await waitFor(() => expect(hasTextTextarea()).toBe(false));
    expect(screen.queryAllByTestId('text-object')).toHaveLength(0);

    // Nothing is recreated, and nothing is left selected that points at the object that is gone: the other
    // person's delete is a fact about the board, not a suggestion.
    expect(texts().some((text) => text.id === id)).toBe(false);
    expect(outlinedIds()).toEqual([]);
  });

  it('TC-25: one undo takes the words and the box back together', async () => {
    renderBoard();
    const id = addText({ x: 200, y: 160 });

    // Open it and write three letters. Story 8 made a burst of typing one step, and each keystroke wrote
    // the character and the box the character needs into the same transaction — which is what this test is
    // really about.
    pressText(id);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(hasTextTextarea()).toBe(true));
    typeIntoText('abc');

    expect(textById(id).text).toBe('abc');
    expect(textById(id).width).toBe(fakeLineWidth(3) + TEXT_BOX_PADDING * 2);

    fireEvent.keyDown(textTextarea(), { key: 'z', ctrlKey: true });

    // One step back, and both fields go back with it. The failure this guards against is half an undo: three
    // letters in a box measured for none, or no letters in a box measured for three. Either way, every other
    // client on the board would draw text spilling out of its own outline, and the person who pressed the key
    // would spend the rest of the session dragging a box that does not belong to its words.
    const undone = textById(id);
    expect(undone.text).toBe('');
    // The box the object was created with: as wide as an empty text is allowed to be, one line tall.
    expect(undone.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(undone.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // And the field still shows what the document holds: the browser's own textarea history, which knows
    // about the characters and nothing about the box, was not allowed to answer instead.
    expect(textTextarea().value).toBe('');
  });

  it('TC-25b: nothing more goes in past the limit, and the counter says so when it is close', async () => {
    renderBoard();
    const id = addText({ x: 100, y: 100 });
    pressText(id);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(hasTextTextarea()).toBe(true));

    // Most of the way to the limit, and the counter has not appeared: five thousand is not a number worth
    // watching while there is room.
    pasteIntoText('a'.repeat(TEXT_MAX_CHARS - 60));
    expect(screen.queryByTestId('text-counter')).toBeNull();

    typeIntoText('b'.repeat(20));
    expect(screen.getByTestId('text-counter').textContent).toBe(`${TEXT_MAX_CHARS - 40}/${TEXT_MAX_CHARS}`);

    // A paste of more than the limit is cut down as it arrives, rather than stored and refused afterwards:
    // a document over the limit is a document every client then has to agree not to draw.
    pasteIntoText('x'.repeat(TEXT_MAX_CHARS + 1));
    await waitFor(() => expect(textContent(id).length).toBe(TEXT_MAX_CHARS));
    expect(textById(id).text).toHaveLength(TEXT_MAX_CHARS);
    expect(screen.getByTestId('text-counter').textContent).toBe(`${TEXT_MAX_CHARS}/${TEXT_MAX_CHARS}`);
  });

  it('the words are drawn as text, and a text made elsewhere is not tidied away', async () => {
    renderBoard();
    // A text object somebody else made and never typed into is a blank line on their board, which is where
    // they left it. The cleanup that removes an abandoned one belongs to the client that made it.
    const id = addText({ x: 120, y: 90 });

    expect(drawnText(id)).toBe('');
    expect(screen.queryAllByTestId('text-object')).toHaveLength(1);

    somebodyTypesInto(id, 'To improve');
    await waitFor(() => expect(drawnText(id)).toBe('To improve'));
    // The box is exactly where the other client left it. This client draws the box it is told about rather
    // than going and answering the same question a second time, which is what keeps two people's measurements
    // from arriving at the board as a fight (`TC-12` is the same rule seen from the other side).
    expect(textById(id).width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('one object, one toolbar: the size buttons and the selection bar never appear together', async () => {
    renderBoard();
    const text = await placeText({ x: 120, y: 100 }, 'Went well');

    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    expect(noteToolbarVisible()).toBe(false);
    expect(deleteSelectionButton()).toBeNull();

    // Two objects selected: the bar takes over and the size buttons go. They belong to one heading, and with
    // two objects selected there is no answer to "which one's size?".
    const note = await placeNote({ x: 420, y: 320 });
    selectAll();
    expect(screen.queryByTestId('text-toolbar')).toBeNull();
    expect(selectionBarVisible()).toBe(true);

    // The toolbar's own bin deletes this text and leaves the note alone: it is the object's toolbar, not a
    // command that acts on whatever the selection happens to be.
    pressText(text);
    fireEvent.click(screen.getByTestId('text-delete'));
    expect(texts().some((item) => item.id === text)).toBe(false);
    expect(stickies().map((item) => item.id)).toEqual([note]);
  });

  it('a text is moved, selected and deselected like any other object', async () => {
    renderBoard();
    const id = await placeText({ x: 140, y: 120 }, 'Went well');
    const before = textById(id);

    // A press on the words selects, and Escape puts the selection down again. Nothing here is text's own
    // invention — it is the board's selection, which is the story's promise about every object type.
    pressSelectKey();
    expect(outlinedIds()).toEqual([id]);

    pressEscape();
    expect(outlinedIds()).toEqual([]);

    expect(textById(id).x).toBe(before.x);
    expect(textById(id).y).toBe(before.y);
  });
});

/* ------------------------------------------------------------ local helpers -- */

/** Press the empty board at a screen point and let go. */
function clickBoard(at: { x: number; y: number }): void {
  fireEvent.pointerDown(surface(), { clientX: at.x, clientY: at.y, button: 0, pointerId: 1 });
  upWindow(at);
}
