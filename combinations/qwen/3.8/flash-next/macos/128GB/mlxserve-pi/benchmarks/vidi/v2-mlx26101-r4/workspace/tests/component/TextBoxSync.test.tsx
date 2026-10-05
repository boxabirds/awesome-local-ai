/**
 * Who writes a text object's box (story 9, TC-12, TC-13).
 *
 * The rule under test is Key decision 1 of the design: the box a piece of text is drawn inside is measured
 * and stored by the client that changed its text, and by no other client. It is a rule about *writes*, so
 * these tests watch writes rather than values — "the box is 46 wide" is equally true whether this client
 * measured it or was told it, and being told is the point. The witness is the object's own observer, which
 * reports every change to `width` or `height` together with whose transaction it was.
 *
 * Why the rule matters, in numbers: five people looking at one heading, one of them typing. If every client
 * measured, that is five measurements per keystroke, five sync messages per keystroke, and five different
 * boxes for the same words — one per font — with the last writer winning. The frame around a heading would
 * be a race, and the marquee that selects by that frame would select different things on different laptops.
 *
 * The font is the layout tests' fake, which counts half a font size per character, so every expected width
 * below is arithmetic rather than a measurement of this machine's fonts.
 */
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';

import {
  TEXT_BOX_PADDING,
  addText,
  clickBoardToText,
  fakeBox,
  fakeLineWidth,
  measureWithFakeFont,
  pressText,
  pressTextKey,
  renderBoard,
  somebodyElse,
  stopWatching,
  textById,
  typeIntoText,
  watchBox,
} from './helpers/textBoard';
import { getTextContent } from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';

describe('text box sync', () => {
  measureWithFakeFont();

  it('TC-12: a local keystroke writes the box once, and this client is the one that wrote it', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText({ x: 300, y: 200 });

    typeIntoText('hello');

    const seeing = watchBox(id);
    typeIntoText('!');

    // One write for one keystroke: not two (measure twice, once in the write and once in a render), and not
    // zero (a box left at the width it was measured at is a box with one character sticking out of it).
    expect(seeing.writes).toHaveLength(1);
    expect(seeing.writes[0]!.local).toBe(true);
    expect(textById(id).width).toBe(fakeLineWidth(6) + TEXT_BOX_PADDING * 2);
    stopWatching(seeing);
  });

  it('TC-12b: a change that arrived from somebody else writes no box at all', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText({ x: 300, y: 200 });
    typeIntoText('mine');
    // The box has settled; whatever happens next is a change this client did not make.
    const before = textById(id).width;

    const seeing = watchBox(id);
    somebodyElse((there) => {
      getTextContent(there, id)?.insert(0, 'their ');
    });

    // The words arrive, and the box they were measured into arrives with them.
    await waitFor(() => expect(textById(id).text).toBe('their mine'));
    // And this client says nothing about the size of somebody else's words. Not one write: an observer on
    // the text would have measured here and put a box in the document in this machine's font, over the top
    // of the box the other client had already measured in theirs.
    expect(seeing.writes).toEqual([]);
    expect(textById(id).width).toBe(before);
    stopWatching(seeing);
  });

  it('TC-12c: every local keystroke writes, so the box keeps up with the words', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText({ x: 300, y: 200 });

    // A word first, so the box is off the floor of the narrowest box the board accepts: below that, typing
    // changes nothing about the box and so writes nothing (which is TC-13, not this).
    typeIntoText('abcd');

    const seeing = watchBox(id);
    typeIntoText('efgh');

    // One write per keystroke rather than one per render or one per burst: each is a transaction of its own,
    // which is what lets a concurrent typist's characters interleave instead of being overwritten.
    expect(seeing.writes.map((write) => write.width)).toEqual([
      fakeLineWidth(5) + TEXT_BOX_PADDING * 2,
      fakeLineWidth(6) + TEXT_BOX_PADDING * 2,
      fakeLineWidth(7) + TEXT_BOX_PADDING * 2,
      fakeLineWidth(8) + TEXT_BOX_PADDING * 2,
    ]);
    expect(seeing.writes.every((write) => write.local)).toBe(true);
    stopWatching(seeing);
  });

  it('TC-13: a measurement that comes out the same as the box already is writes nothing', async () => {
    renderBoard();
    pressTextKey();
    const id = await clickBoardToText({ x: 300, y: 200 });

    // Type up to the widest box an auto-width piece of text is allowed. The measurement runs on every one of
    // these keystrokes, and writes for all but the last: the box is what changes, and stops changing.
    typeIntoText('a'.repeat(60));
    expect(textById(id).width).toBe(616);

    const seeing = watchBox(id);
    // One character more. The measurement happens — this is a local keystroke, and the client that changes
    // the text is the one that owns the box — and it comes to exactly the box the document already holds,
    // so nothing goes into the document. A measurement that changes nothing must not cost a sync message:
    // this path is walked on every keystroke, and typing a long annotation would otherwise be a message per
    // character on top of the message per character that the characters themselves cost.
    typeIntoText('a');

    expect(seeing.writes).toEqual([]);
    expect(textById(id).text).toBe('a'.repeat(61));
    expect(textById(id).width).toBe(fakeBox(60).width);
    stopWatching(seeing);
  });

  it('a text that has never been measured is drawn at the narrowest box the board accepts', async () => {
    renderBoard();
    // Made straight into the document, by a colleague's client or by a board saved before this story: no
    // measurement of the kind this app does has ever been taken of it.
    const id = addText({ x: 120, y: 80 });
    pressText(id);

    expect(textById(id).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(textById(id).height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});
