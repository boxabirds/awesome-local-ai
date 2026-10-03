// text.layout / box sync component tests (story 9, TC-12, TC-13).
//
// The rule under test is the one that keeps five clients from racing to write
// dimensions: a text object's stored box is written by the client that *changed* the
// object, and by nobody else. That is a statement about transaction origins, so the
// test needs two real documents — the rendered board and a peer that is synchronised
// with it exactly like the sync server synchronises two browsers (`peerTab()`). A fake
// measurer is injected through `MeasurerProvider` so the expected box is arithmetic
// rather than a font metric.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import { MeasurerProvider } from '../../src/client/objects/textMeasurer';
import type { Measurer } from '../../src/client/objects/textLayout';
import { getTextContent } from '../../src/shared/objects/text';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  TEST_BOARD_ID,
  boxWritesOf,
  createTextObject,
  editTextObject,
  editorEl,
  objectBox,
  peerTab,
  textFields,
  textFixedWidth,
  textSizePreset,
  typeIntoEditor,
} from './helpers';

/** 0.5 world units per character per unit of font size: 10 units per character at M. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** The box the fake measurer gives for `text` at `size`, in auto width mode. */
function expectedBox(text: string, size: 'S' | 'M' | 'L' | 'XL', lines = 1) {
  return {
    width: text.length * TEXT_SIZES[size] * 0.5 + TEXT_AUTO_WIDTH_PADDING_WORLD,
    height: Math.round(lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT),
  };
}

function mount(): void {
  window.history.replaceState(null, '', `/b/${TEST_BOARD_ID}`);
  render(
    <MeasurerProvider value={measure}>
      <Board boardId={TEST_BOARD_ID} />
    </MeasurerProvider>,
  );
}

describe('text box sync', () => {
  it('TC-12 writes nothing for a remote change and exactly one box for a local one', () => {
    mount();
    const id = createTextObject(0, 0);
    editTextObject(id);

    // A local edit re-measures: one write, with the box the measurer says.
    const localWrites = boxWritesOf(id, () => typeIntoEditor('Went well'));
    expect(localWrites).toBe(1);
    expect(objectBox(id)).toEqual(expectedBox('Went well', 'M'));

    // The same board in another tab types into the same text object.
    const peer = peerTab();
    const remoteWrites = boxWritesOf(id, () => {
      const theirs = getTextContent(peer, id);
      if (!theirs) throw new Error('peer does not have the text object');
      theirs.insert(theirs.length, ' everyone');
    });

    // This client neither writes a box nor argues about it: the peer's client already
    // measured and stored one, and re-measuring here would only race it.
    expect(remoteWrites).toBe(0);
    // The text itself still arrives, and the box that arrives with it is the peer's.
    expect(textFields(id).text).toBe('Went well everyone');
    expect(objectBox(id)).toEqual(expectedBox('Went well', 'M'));
    // The open editor shows what the other person typed (no character is lost).
    expect(editorEl()).toHaveProperty('value', 'Went well everyone');

    // And a change made *here* is measured and written once, on top of what arrived.
    const mine = 'Went well everyone!';
    const again = boxWritesOf(id, () => typeIntoEditor(mine));
    expect(again).toBe(1);
    expect(objectBox(id)).toEqual(expectedBox(mine, 'M'));
  });

  it('TC-13 does not write a box that did not actually change', () => {
    mount();
    const id = createTextObject(0, 0);
    editTextObject(id);
    typeIntoEditor('Went well');
    const before = objectBox(id);

    // A local size change that leaves the measurement where it was writes nothing:
    // the same preset again is a no-op, and the re-measure that follows it agrees.
    const writes = boxWritesOf(id, () => textSizePreset(id, 'M'));
    expect(writes).toBe(0);
    expect(objectBox(id)).toEqual(before);

    // The same for a fixed width that is already the stored width: the drag itself
    // writes the width and the mode, and the re-measure that follows it has nothing to
    // add, so no height is written and the box is what it was.
    const again = boxWritesOf(id, () => textFixedWidth(id, before.width), ['height']);
    expect(again).toBe(0);
    expect(objectBox(id)).toEqual(before);
    expect(textFields(id).widthMode).toBe('fixed');
  });

  it('TC-13 going from auto to a dragged fixed width rewraps and writes the height once', () => {
    mount();
    const id = createTextObject(0, 0);
    editTextObject(id);
    const text = 'Shipped the infinite board a full day early';
    typeIntoEditor(text);
    // Auto: the box hugs the text (still inside the cap), and the mode is auto.
    expect(textFields(id).widthMode).toBe('auto');
    expect(textFields(id).width).toBe(expectedBox(text, 'M').width);

    // Drag the side handle in to a third of the width: the drag writes the width,
    // this client re-measures once and stores the taller, rewrapped box.
    const dragged = 150;
    const heightWrites = boxWritesOf(id, () => textFixedWidth(id, dragged), ['height']);
    expect(heightWrites).toBe(1);

    const after = textFields(id);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBe(dragged);
    // 150 units fits 30 characters at M (10 units each), so 45 characters take lines.
    expect(after.height).toBeGreaterThan(Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT));
    expect(after.height).toBe(4 * Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT));
    // Repeating the same drag width changes nothing at all (no redundant write).
    expect(boxWritesOf(id, () => textFixedWidth(id, dragged), ['height'])).toBe(0);
    expect(textFields(id).height).toBe(after.height);
  });

  it('a remote size change leaves the stored box alone', () => {
    mount();
    const id = createTextObject(0, 0);
    editTextObject(id);
    typeIntoEditor('Went well');
    const before = objectBox(id);

    const peer = peerTab();
    const writes = boxWritesOf(id, () => {
      const obj = peer.getMap<unknown>('objects').get(id) as {
        set(key: string, value: unknown): void;
      };
      obj.set('size', 'XL');
    });
    expect(writes).toBe(0);
    // The size arrived, and the box that was stored with it is untouched.
    expect(textFields(id).size).toBe('XL');
    expect(objectBox(id)).toEqual(before);
  });

  it('an object created empty already has a box, and typing into it writes once', () => {
    mount();
    const id = createTextObject(12, 8);
    // Bounds exist from the moment the object does, so selection and marquee work on
    // a text object that has never been measured.
    expect(objectBox(id)).toEqual({ width: TEXT_MIN_WIDTH_WORLD, height: 26 });
    editTextObject(id);
    // A word too short to outgrow that minimum still needs no write either ...
    expect(boxWritesOf(id, () => typeIntoEditor('Hi'))).toBe(0);
    // ... but anything wider than the minimum measures once and stores the box.
    expect(boxWritesOf(id, () => typeIntoEditor('Hi there'))).toBe(1);
    expect(objectBox(id)).toEqual(expectedBox('Hi there', 'M'));
  });
});
