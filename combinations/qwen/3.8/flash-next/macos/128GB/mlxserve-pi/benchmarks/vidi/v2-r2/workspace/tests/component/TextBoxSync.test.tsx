// text.layout (ui-component): who is allowed to measure the text.
//
// A text object's box is the text's own, so it has to be measured - and the
// question that decides whether a board settles or churns is *who* does it. The
// rule this file holds: the client that changed the text measures it and stores
// the box; a client that only received the change stores nothing. Two clients
// measuring the same words with fonts that differ by a pixel would otherwise
// write the box back and forth forever, and every write would be an update the
// room has to keep.

import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { TEXT_SIZES } from '../../src/shared/config';
import { remeasureTextBox } from '../../src/client/objects/useTextBoxSync';
import { SHORT_PHRASE } from '../fixtures/texts';
import {
  clickOn,
  countBoxWrites,
  doubleClickOn,
  newText,
  newTextWithText,
  pressKeyOn,
  remoteTextEdit,
  renderBoard,
  storedBox,
  textAt,
  textEditorElement,
  textSizeButton,
  textToolbarElement,
  typeIntoText,
  useBoardTestLifecycle,
} from './helpers';

/** Put the measurement question to the model directly, inside act(). */
function measure(doc: Parameters<typeof remeasureTextBox>[0], id: string): boolean {
  let changed = false;
  act(() => {
    changed = remeasureTextBox(doc, id);
  });
  return changed;
}

describe('who measures a text object', () => {
  useBoardTestLifecycle();

  // TC-12
  it('TC-12 stores nothing for a change that arrived from elsewhere, and one box for a local one', () => {
    const { doc } = renderBoard();
    const id = newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);
    const before = storedBox(doc, id)!;

    doubleClickOn(textAt(0));
    expect(textEditorElement()).not.toBeNull();

    // A colleague types into the same text. Their client measured it already, so
    // this one shows the words and leaves the numbers they stored alone.
    const remoteWrites = countBoxWrites(doc, id, () => {
      remoteTextEdit(doc, id, ' indeed', SHORT_PHRASE.length);
    });
    expect(remoteWrites).toBe(0);
    expect(storedBox(doc, id)).toEqual(before);
    // the words did arrive: the next keystroke here must not write them out again
    expect(textEditorElement()?.value).toBe(`${SHORT_PHRASE} indeed`);

    // My own keystroke, on top of what arrived: the box is mine to measure, and
    // one keystroke means exactly one box written.
    const mine = `${SHORT_PHRASE} indeed, and it lands on the board`;
    const localWrites = countBoxWrites(doc, id, () => {
      typeIntoText(mine);
    });
    expect(localWrites).toBe(1);
    const after = storedBox(doc, id)!;
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(0);
  });

  // TC-12, the same rule with the caret nowhere near the text
  it('TC-12 leaves a text nobody here touched exactly as it arrived', () => {
    const { doc } = renderBoard();
    const id = newText(doc, { x: 40, y: 40 });

    const writes = countBoxWrites(doc, id, () => {
      remoteTextEdit(doc, id, SHORT_PHRASE);
    });

    expect(writes).toBe(0);
    // the box another client stored is the box this board draws
    expect(storedBox(doc, id)!.width).toBeGreaterThan(0);
    expect(textAt(0).style.width).toBe(`${storedBox(doc, id)!.width}px`);
  });

  // TC-13
  it('TC-13 writes no box when the measurement comes to the box it already had', () => {
    const { doc } = renderBoard();
    const id = newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);

    expect(measure(doc, id)).toBe(true);
    const measured = storedBox(doc, id)!;

    // Asked again with the same text, the layout returns the same numbers and
    // says it changed nothing - so nothing goes on the wire.
    const writes = countBoxWrites(doc, id, () => {
      expect(measure(doc, id)).toBe(false);
    });

    expect(writes).toBe(0);
    expect(storedBox(doc, id)).toEqual(measured);
  });

  // TC-13, the same rule through the toolbar a person can click
  it('TC-13 clicking the size the text already is changes nothing on the document', () => {
    const { doc } = renderBoard();
    const id = newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);
    clickOn(textAt(0));
    expect(textToolbarElement()).not.toBeNull();
    expect(textSizeButton('M')?.getAttribute('aria-pressed')).toBe('true');
    const before = storedBox(doc, id)!;

    const writes = countBoxWrites(doc, id, () => {
      clickOn(textSizeButton('M'));
    });

    expect(writes).toBe(0);
    expect(storedBox(doc, id)).toEqual(before);
    expect(textSizeButton('M')?.getAttribute('aria-pressed')).toBe('true');
  });

  // TC-21's box half: the toolbar's size button, and the undo step it makes
  it('TC-21 a size change reflows the box, and only the size and the box change', () => {
    const { doc } = renderBoard();
    const id = newTextWithText(doc, { x: 120, y: 80 }, SHORT_PHRASE);
    clickOn(textAt(0));
    const before = storedBox(doc, id)!;

    clickOn(textSizeButton('XL'));

    const after = storedBox(doc, id)!;
    expect(after.size).toBe('XL');
    // where it sits is not a size's business: the top-left corner stays put
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.width).toBeGreaterThan(before.width);
    // the type on the screen is the size the preset names
    expect(Number(textAt(0).dataset.fontPx)).toBe(TEXT_SIZES.XL);
    expect(textSizeButton('XL')?.getAttribute('aria-pressed')).toBe('true');
    expect(textSizeButton('M')?.getAttribute('aria-pressed')).toBe('false');

    // Size and box are one undo step: one press reverses both.
    pressKeyOn(window, 'z', { ctrlKey: true });
    const undone = storedBox(doc, id)!;
    expect(undone.size).toBe('M');
    expect(undone.height).toBe(before.height);
    expect(undone.width).toBe(before.width);
  });
});
