// Who is allowed to write a text object's box (`text.box_sync`).
//
// This is the consistency test, and the one place the design's central rule gets
// asserted rather than trusted: *only the client that changed the text measures it*.
// If every client measured, one keystroke would produce a write per client, and because
// the wrap is not perfectly invertible those writes would disagree — two people would
// watch a box flicker between two heights. So a change that arrived from elsewhere is
// drawn and never re-measured, and a change made here writes the box exactly once.
//
// The measurer is the board's own. jsdom cannot make a canvas context, so it lays out
// from its fixed estimate (see helpers/text-ui.tsx): deterministic on every machine, and
// the same code path a real browser takes.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md (Key decision 1)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { measureTextBox, useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { boardMeasurer, TEXT_ESTIMATED_GLYPH_RATIO } from '../../src/client/objects/textLayout';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  UNDO_CAPTURE_TIMEOUT_MS,
} from '../../src/shared/config';
import {
  advance,
  clickEmpty,
  clickTextToolbar,
  countBoxWrites,
  doc,
  endEditWithEscape,
  FakeWebsocketProvider,
  open,
  pressKey,
  pressUndo,
  ytextIn,
  remoteChange,
  textEditor,
  textIds,
  textIsBeingEdited,
  textObject,
  boxSize,
  typeText,
} from './helpers/text-ui';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'text-box-sync-under-test';
const FONT_M = 20; // TEXT_SIZES.M, in board units
const LINE_M = FONT_M * TEXT_LINE_HEIGHT;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('text.box_sync', () => {
  // TC-12
  it('TC-12 writes the box once for a local change and never for one from elsewhere', () => {
    const id = placeText('');

    // An empty text already has the box it needs: measuring it writes nothing.
    expect(countBoxWrites(id, () => typeText(''))).toBe(0);

    // Typing here measures and writes, exactly once for the keystroke.
    expect(countBoxWrites(id, () => typeText('Hello'))).toBe(1);
    expect(textObject(id).text).toBe('Hello');
    expect(boxSize(id)).toEqual({ width: expectedWidth('Hello'), height: LINE_M });

    // Now the same document changes *elsewhere* — with the caret still in the box. The
    // text arrives with its box already in it: this client draws it and adds nothing.
    const boxBefore = boxSize(id);
    const writes = countBoxWrites(id, () => {
      remoteChange((other) => {
        ytextIn(other, id).insert(0, 'From elsewhere ');
      });
    });

    expect(writes).toBe(0);
    // The editor followed the document, which is the whole job of a remote change.
    expect(textEditor().value).toBe('From elsewhere Hello');
    expect(textIsBeingEdited()).toBe(true);
    expect(boxSize(id)).toEqual(boxBefore);

    // A person typing here afterwards is the one who measures the result.
    expect(countBoxWrites(id, () => typeText('From elsewhere Hello!'))).toBe(1);
  });

  // TC-13
  it('TC-13 writes nothing when the box is already what the text needs', () => {
    const id = placeText('Hello');

    // Nothing left to work out: the box in the document is the box the layout answers.
    expect(measureTextBox(doc(), id, boardMeasurer)).toBeNull();
    expect(boxSize(id)).toEqual({ width: expectedWidth('Hello'), height: LINE_M });

    const { result } = renderHook(() => useTextBoxSync(doc(), id, boardMeasurer));
    // Local changes call it; a call with nothing changed writes nothing.
    expect(countBoxWrites(id, () => result.current.remeasureAfterLocalChange())).toBe(0);

    // A change that needs a new box writes once, and the call straight after it writes
    // nothing again: the box is not rewritten on every frame.
    expect(countBoxWrites(id, () => typeText('Hello\nthere'))).toBe(1);
    expect(countBoxWrites(id, () => result.current.remeasureAfterLocalChange())).toBe(0);
    expect(boxSize(id).height).toBe(LINE_M * 2);
  });

  it('TC-13b puts the size and the box back in one undo', () => {
    const id = placeText('abc');
    endEditWithEscape();
    const before = boxSize(id);

    clickTextToolbar('text-size-XL');
    expect(textObject(id).size).toBe('XL');
    expect(boxSize(id).height).toBeGreaterThan(before.height);

    advance(UNDO_CAPTURE_TIMEOUT_MS + 1);
    pressUndo();
    // One step takes the size and the box back together, because they were one step.
    expect(textObject(id).size).toBe('M');
    expect(boxSize(id)).toEqual(before);
  });
});

// --- helpers local to this file ---------------------------------------------

/**
 * The width a line of this many characters needs at size M, plus the air around it —
 * the estimate the measurer falls back to, spelled out so the expectation is a number
 * a reader can check rather than a call to the code under test.
 */
function expectedWidth(text: string): number {
  const longest = Math.max(
    ...text.split('\n').map((line) => line.length * FONT_M * TEXT_ESTIMATED_GLYPH_RATIO),
  );
  return Math.max(TEXT_MIN_WIDTH_WORLD, Math.min(longest + 16, 600));
}

/** Place a text object and type into it, leaving the editor open. */
function placeText(value: string): string {
  const before = textIds();
  pressKey({ key: 't' });
  clickEmpty({ x: 80, y: 20 });
  const created = textIds().find((id) => !before.includes(id));
  if (!created) throw new Error('the text tool placed nothing');
  advance(16); // the frame the caret is placed in
  if (value !== '') typeText(value);
  return created;
}
