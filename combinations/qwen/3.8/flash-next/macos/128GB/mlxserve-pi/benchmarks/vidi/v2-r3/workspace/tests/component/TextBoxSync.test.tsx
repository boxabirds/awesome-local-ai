import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTextDiff } from '../../src/client/objects/StickyText';
import { createCanvasMeasurer } from '../../src/client/objects/textLayout';
import { remeasureTextBox } from '../../src/client/objects/useTextBoxSync';
import { setTextWidthAuto, setTextWidthFixed } from '../../src/shared/objects/text';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import {
  applyRemote,
  createNote,
  createTextObject,
  flushFrame,
  openTextEditor,
  peerOf,
  peerText,
  renderBoard,
  setTextObjectText,
  textData,
  typeIntoText,
  watchBoxWrites,
} from './helpers';

/**
 * TC-12, TC-13: who is allowed to write a text object's box.
 *
 * A stored box is a copy of a measurement, and every client watching the board
 * makes the same measurement — so if a box were rewritten whenever anybody
 * changed the text, five people looking at one heading would produce five
 * transactions and five sync messages for one keystroke, and each person's undo
 * history would fill up with box writes they never made. Only the client that
 * made the change measures it, which is the whole rule these two tests are about.
 *
 * The writes are counted where they can't be argued with: the document itself,
 * for transactions that changed a stored width or height.
 */

const TEXT = 'Weekly sync notes';

let doc: Doc;
let boxWrites: () => number;

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A text object with some text in it, as a test's subject. */
function subject(text = TEXT): string {
  const id = createTextObject(doc, 40, 60);
  setTextObjectText(doc, id, text);
  flushFrame();
  return id;
}

describe('the box is written by the client that changed the text', () => {
  it('TC-12 remeasures nothing at all for a change that arrived from elsewhere', () => {
    const id = subject();
    boxWrites = watchBoxWrites(doc);

    // Another person changes the same text, and the change arrives as a sync
    // message: the same document, a transaction that did not begin here.
    const peer = peerOf(doc);
    act(() => {
      applyTextDiff(peerText(peer, id), `${TEXT} from the other side`, null);
    });
    applyRemote(doc, peer);
    flushFrame();

    // The text is here, and it is rendered — the board is not waiting for
    // permission to show what it was given.
    expect(textData(doc, id)?.text).toBe(`${TEXT} from the other side`);
    // And not one box was written here in answer to it.
    expect(boxWrites()).toBe(0);
  });

  it('TC-12 writes exactly one box for a change made here, and it is the measured one', () => {
    const id = subject();
    boxWrites = watchBoxWrites(doc);

    const editor = openTextEditor(id);
    const typed = `${TEXT} — bring your own question`;
    typeIntoText(id, typed);
    flushFrame();

    expect(editor.value).toBe(typed);
    expect(textData(doc, id)?.text).toBe(typed);
    expect(boxWrites()).toBe(1);

    // And what it wrote is the box the measurement gives: measuring again, with
    // the same measurer the board uses, finds nothing left to say.
    const stored = textData(doc, id)!;
    expect(stored.width).toBeGreaterThan(0);
    expect(stored.height).toBeGreaterThan(0);
    expect(remeasureTextBox(doc, id, createCanvasMeasurer())).toBe(false);
    expect(boxWrites()).toBe(1);
  });

  it('TC-13 leaves the stored box alone when a size press measures the same box', () => {
    const id = subject('Short heading');
    openTextEditor(id);
    typeIntoText(id, 'Short heading');
    flushFrame();
    boxWrites = watchBoxWrites(doc);

    // The size button already lit is pressed again. The text is the same, the
    // size is the same, and so is the box that comes back out of the measurement:
    // a write would be a message to everyone about something that did not change.
    fireEvent.click(screen.getByRole('button', { name: 'Medium text' }));
    flushFrame();

    expect(boxWrites()).toBe(0);
  });

  it('TC-13 takes over a width without writing a box that has not changed', () => {
    const id = subject('One line only');
    openTextEditor(id);
    typeIntoText(id, 'One line only');
    flushFrame();
    const before = textData(doc, id)!;
    boxWrites = watchBoxWrites(doc);

    // 'Fixed width' takes the width the text has earned and hands it the height.
    // The width is unchanged, the number of lines is unchanged, so the height is
    // unchanged: the mode changes and the box does not.
    const mode = screen.getByRole('button', { name: 'Fixed width' });
    expect(mode).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mode);
    flushFrame();

    const after = textData(doc, id)!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(boxWrites()).toBe(0);
    expect(screen.getByRole('button', { name: 'Fixed width' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('writes a box when the lines really do change, and none when they do not', () => {
    const long = 'The quick brown fox jumps over the lazy dog and keeps on running for a while';
    const id = subject(long);
    openTextEditor(id);
    typeIntoText(id, long);
    flushFrame();
    const typed = textData(doc, id)!;
    expect(typed.widthMode).toBe('auto');
    expect(typed.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    boxWrites = watchBoxWrites(doc);

    // The text already fills the widest line it is allowed, so taking that width
    // over changes the mode and not the box.
    const mode = screen.getByRole('button', { name: 'Fixed width' });
    expect(mode).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mode);
    flushFrame();
    expect(textData(doc, id)!.widthMode).toBe('fixed');
    expect(boxWrites()).toBe(0);

    // A side handle dragged inwards gives it fewer characters per line, which is
    // more lines, which is a taller box: a change made here, so it is written.
    act(() => {
      setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD * 2);
      remeasureTextBox(doc, id, createCanvasMeasurer());
    });
    const narrow = textData(doc, id)!;
    expect(narrow.width).toBe(TEXT_MIN_WIDTH_WORLD * 2);
    expect(narrow.height).toBeGreaterThan(typed.height);
    const writesAfterNarrow = boxWrites();
    expect(writesAfterNarrow).toBeGreaterThan(0);

    // And back to the text's own width, which is another change made here.
    fireEvent.click(screen.getByRole('button', { name: 'Fixed width' }));
    flushFrame();
    expect(textData(doc, id)!.widthMode).toBe('auto');
    expect(screen.getByRole('button', { name: 'Fixed width' })).toHaveAttribute('aria-pressed', 'false');
    expect(boxWrites()).toBeGreaterThan(writesAfterNarrow);
    const backAgain = textData(doc, id)!;
    expect(backAgain.width).toBe(typed.width);
    expect(backAgain.height).toBe(typed.height);
    expect(remeasureTextBox(doc, id, createCanvasMeasurer())).toBe(false);
  });

  it('answers nothing at all about an object that is not there', () => {
    const id = subject();
    expect(remeasureTextBox(doc, 'no-such-object', createCanvasMeasurer())).toBe(false);
    // A sticky note is not a text object, and is not measured or widened as one.
    const sticky = createNote(doc, 500, 500);
    expect(remeasureTextBox(doc, sticky, createCanvasMeasurer())).toBe(false);
    expect(setTextWidthAuto(doc, sticky)).toBe(false);
    expect(setTextWidthFixed(doc, sticky, 200)).toBe(false);
  });
});
