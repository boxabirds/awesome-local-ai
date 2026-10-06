/**
 * TC-12, TC-13 — who is allowed to write a text object's box.
 *
 * A text object stores its own width and height, which makes it the first object on this board whose
 * stored shape is somebody's *measurement*. And a measurement is the one kind of value on a replicated
 * document that two machines cannot both supply: the same words at the same size in two fonts are two
 * widths, and five people watching one person type would put five different boxes on the same document,
 * in an order nobody can predict, and the selection would be a different size on every screen.
 *
 * So the rule these tests hold: the box is written by the client that changed the text, and by no client
 * that merely watched it change. `useTextBoxSync` is written to make that structural rather than
 * careful — it subscribes to nothing, so there is no listener that could fire on somebody else's change
 * and no effect to get the origin test wrong in. What is checked here is therefore mostly what does not
 * happen: no write, no update, no message to anybody else.
 *
 * The second half is the same rule seen from the other side: a local change writes the box exactly once,
 * and a remeasure that arrives at the numbers the document already holds writes nothing at all. A board
 * that rewrote the same box on every keystroke would be a board that sent a message per character and
 * filled this person's undo history with steps that undo into the same picture.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import type { Doc } from 'yjs';

import { LOCAL_ORIGIN, snapshot } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { remeasureTextBox, useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

/** A ruler with nothing browser-shaped about it: half a font size to the character. */
const ruler: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** The middle size, and the height of one line of it, in the units the document stores. */
const M = TEXT_SIZES.M;
const LINE_M = M * TEXT_LINE_HEIGHT;

/** The box as the document holds it, which is the only box anybody else ever sees. */
const boxOf = (doc: Doc, id: string): { width: number; height: number; size: string } => {
  const object = snapshot(doc).find((candidate) => candidate.id === id) as TextSnapshot | undefined;
  if (object === undefined) throw new Error('the text object is not on the board');
  return {
    width: object.width ?? Number.NaN,
    height: object.height ?? Number.NaN,
    size: object.size,
  };
};

/** The hook, wired to a button: pressing it is what a local change does. */
function BoxWriter({ doc, id }: { doc: Doc; id: string }): React.JSX.Element {
  const sync = useTextBoxSync(doc, id, ruler);
  return (
    <button onClick={() => sync.remeasureAfterLocalChange()} data-testid="remeasure" type="button">
      measure it
    </button>
  );
}

interface Rig {
  doc: Doc;
  id: string;
  /** How many times this screen has changed the stored box, which is how many it wrote about it. */
  boxWrites(): number;
  /** The box the document holds. */
  box(): { width: number; height: number; size: string };
  /** Types into the text the way the person typing does — a local change. */
  typeLocally(text: string): Promise<void>;
  /** The same characters arriving from somebody else's screen. */
  typeRemotely(text: string): Promise<void>;
  /** Asks for the box, the way an input handler, a toolbar button or a handle drag does. */
  measure(): Promise<void>;
}

function aTextObject(text = ''): Rig {
  const doc = new Y.Doc();
  const id = createText(doc, { x: 100, y: 50 }, 'tester');
  if (typeof id !== 'string') throw new Error('createText refused the point');
  let writes = 0;
  let seen = boxOf(doc, id);
  // Counted by what arrived rather than by who was called: a change to the text, or to the size, or to
  // anything else in the document is not a write about the box, and a box that came out the same as the
  // one already stored is not a write either. That is the whole rule of this file, counted.
  doc.on('update', (_update: unknown, origin: unknown) => {
    if (origin !== LOCAL_ORIGIN) return;
    const now = boxOf(doc, id);
    if (now.width !== seen.width || now.height !== seen.height) writes += 1;
    seen = now;
  });
  const ytext = getTextContent(doc, id);
  if (ytext === undefined) throw new Error('the text object has no text');
  if (text.length > 0) ytext.insert(0, text);

  render(<BoxWriter doc={doc} id={id} />);

  const write = (fn: () => void, origin: unknown): Promise<void> =>
    act(async () => {
      doc.transact(fn, origin);
      await frame();
    });

  return {
    doc,
    id,
    boxWrites: () => writes,
    box: () => boxOf(doc, id),
    typeLocally: (next: string) =>
      write(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, next);
      }, LOCAL_ORIGIN),
    typeRemotely: (next: string) =>
      write(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, next);
      }, undefined),
    measure: () =>
      act(async () => {
        fireEvent.click(screen.getByTestId('remeasure'));
        await frame();
      }),
  };
}

const frame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('useTextBoxSync — the box of a text object is written by the screen that changed it', () => {
  it('TC-12 writes nothing when the text changed on somebody else screen', async () => {
    const rig = aTextObject();
    const created = rig.box();
    expect(created.width).toBeGreaterThan(0);

    await rig.typeRemotely('Went well, and the board is still the same shape');

    // The words arrived; the box did not move, and no message left this screen about it. The person
    // who typed them measured them, and their font is not this font.
    expect(rig.boxWrites()).toBe(0);
    expect(rig.box()).toEqual(created);
  });

  it('TC-12 writes the box once when the change was made here', async () => {
    const rig = aTextObject();
    await rig.typeLocally('Went well');

    await rig.measure();

    // Nine characters at the middle size, half a font size to the character, on one line: the box is as
    // wide as the words and not one unit wider.
    expect(rig.boxWrites()).toBe(1);
    expect(rig.box()).toEqual({ width: 9 * M * 0.5, height: LINE_M, size: 'M' });
  });

  it('TC-13 writes nothing when the remeasure arrives at the box the document already holds', async () => {
    const rig = aTextObject('Went well');
    await rig.measure();
    // The first measurement does write: the text arrived in somebody else's transaction, and the box in
    // the document is still the estimate the object was created with.
    expect(rig.boxWrites()).toBe(1);
    const box = rig.box();

    // Asked again, about the same text, the same size and the same width: the same answer, and the
    // document cannot tell that it was ever asked. This is the write that a board would otherwise make
    // once per keystroke, for a box that has not moved since the first one.
    await rig.measure();
    await rig.measure();
    expect(rig.boxWrites()).toBe(1);
    expect(rig.box()).toEqual(box);
  });

  it('TC-12 writes one box per local change, and takes the newest numbers each time', async () => {
    const rig = aTextObject();
    const heights: number[] = [];

    for (const text of ['one', 'one\ntwo', 'one\ntwo\nthree']) {
      await rig.typeLocally(text);
      await rig.measure();
      heights.push(rig.box().height);
    }

    // Three changes, three writes — no batching, no timer, nothing that could be the reason a box is
    // a line out of date on somebody else's screen.
    expect(rig.boxWrites()).toBe(3);
    expect(heights).toEqual([LINE_M, 2 * LINE_M, 3 * LINE_M]);
  });
  it('TC-13 measures against the document and not against the render it was called from', async () => {
    const rig = aTextObject('Went well');
    await rig.measure();
    const before = rig.box();
    expect(before.width).toBeCloseTo(9 * M * 0.5, 6);

    // The toolbar's own path: the size is written first and the box is measured afterwards, so the
    // measurement is taken from a document that already says XL while the screen still shows M. A box
    // measured from the numbers in this render would be the old box, and the selection would be a
    // heading-sized box around body text.
    const writes = rig.boxWrites();
    await act(async () => {
      setTextSize(rig.doc, rig.id, 'XL');
      await frame();
    });
    await rig.measure();

    // One write about the box, for one thing the person did. The size they picked is its own change and
    // not a change of box: what is sent about the box is the box, once, and the measurement of it.
    expect(rig.boxWrites() - writes).toBe(1);
    expect(rig.box().width).toBeCloseTo(9 * TEXT_SIZES.XL * 0.5, 6);
    expect(rig.box().height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);
    expect(rig.box().size).toBe('XL');
  });

  it('keeps a width the person dragged to and rewraps the height into it', async () => {
    const rig = aTextObject('went well today');
    await rig.measure();
    const tall = rig.box();

    const writes = rig.boxWrites();
    await act(async () => {
      setTextWidthFixed(rig.doc, rig.id, 40);
      await frame();
    });
    await rig.measure();

    const narrow = rig.box();
    // The width is the person's and the height is the text's: four words into forty units is not one
    // line any more, and nobody was asked to make that happen.
    expect(narrow.height).toBeGreaterThan(tall.height);
    // Two writes about the box, and one thing the person did: the width is theirs, from the handle, and
    // the height is the text's, from the measurement that follows it in the same capture window. Undo
    // takes both back together, which is what story 8's boundaries are for.
    expect(rig.boxWrites() - writes).toBe(2);
    expect(narrow.width).toBe(40);
    expect(narrow.height).toBe(3 * LINE_M);
  });

  it('writes nothing about an object that is not a text object, and says so', () => {
    const rig = aTextObject('Went well');
    const before = rig.boxWrites();

    expect(remeasureTextBox(rig.doc, 'no-such-object', ruler)).toBe(false);
    expect(remeasureTextBox(rig.doc, '', ruler)).toBe(false);
    expect(rig.boxWrites()).toBe(before);
  });
});
