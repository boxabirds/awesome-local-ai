/**
 * Who measures a text object's box - `tests/component/TextBoxSync.test.tsx`.
 *
 * `src/client/objects/useTextBoxSync.ts` holds one rule with two halves, and both
 * are about who writes: the client that changed the text writes the measured box,
 * and nobody else ever does. Get the first half wrong and text is drawn in a box
 * that is too small; get the second half wrong and every keystroke by two people
 * on the same text object becomes an argument over the box, because each client
 * would answer the other's update with a write of its own.
 *
 * So the assertions are counts of transactions on the *local* document, filtered
 * by origin: a write from this tab carries `LOCAL_ORIGIN`, and a change that
 * arrived from a peer carries the peer's origin. A peer is a real second `Y.Doc`
 * kept in step both ways, the way a room keeps two browsers in step - a mocked
 * "remote change" would test the hook against a document no board is ever in.
 *
 * The editor is the real one, at the real limit; only the measurer is fake, so the
 * expected box is arithmetic rather than a guess at a font.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useMemo } from 'react';
import type { JSX } from 'react';

import * as Y from 'yjs';

import { act, cleanup, fireEvent, render } from './tl.js';
import { drainFrames } from './setup.js';

import { initDoc, LOCAL_ORIGIN, OBJECT_FIELDS } from '../../src/shared/board-model.js';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config.js';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
  TEXT_TYPE,
} from '../../src/shared/objects/text.js';
import { TextEditor, TEXT_EDITOR_OWNER_ATTRIBUTE } from '../../src/client/objects/TextEditor.js';
import { useTextBoxSync, remeasureTextBox } from '../../src/client/objects/useTextBoxSync.js';
import type { Measurer } from '../../src/client/objects/textLayout.js';

/** Half a board unit per board unit of font size: 10 units per character at size M. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** What a line of `characters` characters is measured to be. */
const boxOf = (characters: number, size: TextSize = 'M') => ({
  width: characters * TEXT_SIZES[size] * 0.5 + TEXT_AUTO_WIDTH_PADDING_WORLD,
  height: TEXT_SIZES[size] * TEXT_LINE_HEIGHT,
});

/* ------------------------------------------------------------------ the peer */

import { createPeer } from './peer.js';


/* ----------------------------------------------------------------- counting */

/** Every transaction on `doc`, split by who made it. */
function countWrites(doc: Y.Doc): { local(): number; remote(): number; stop(): void } {
  let local = 0;
  let remote = 0;
  const listener = (_update: Uint8Array, origin: unknown): void => {
    if (origin === LOCAL_ORIGIN) local += 1;
    else remote += 1;
  };
  doc.on('update', listener);
  return {
    local: () => local,
    remote: () => remote,
    stop: () => {
      doc.off('update', listener);
    },
  };
}

/* ----------------------------------------------------------------- harness */

const mapOf = (doc: Y.Doc, id: string): Y.Map<unknown> =>
  doc.getMap<Y.Map<unknown>>('objects').get(id)!;

const storedBox = (doc: Y.Doc, id: string): { width: number; height: number } => {
  const map = mapOf(doc, id);
  return { width: map.get('width') as number, height: map.get('height') as number };
};

interface HarnessProps {
  doc: Y.Doc;
  id: string;
}

/** The object's own component, reduced to what it does about its box. */
function Harness({ doc, id }: HarnessProps): JSX.Element {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measure);
  const ytext = useMemo(() => getTextContent(doc, id), [doc, id]);
  if (!ytext) throw new Error('the harness has no text object');
  const size = mapOf(doc, id).get('size');
  return (
    <div data-text-object={id} data-testid="text-object">
      <TextEditor
        ytext={ytext}
        maxChars={TEXT_MAX_CHARS}
        fontPx={TEXT_SIZES[size === 'XL' ? 'XL' : 'M']}
        width={mapOf(doc, id).get('width') as number}
        onInput={remeasureAfterLocalChange}
        onEnd={() => undefined}
        label="Text"
        testId="text-editor"
        className="text-editor"
        ownerAttribute={TEXT_EDITOR_OWNER_ATTRIBUTE}
      />
    </div>
  );
}

/** Type into the open editor the way the browser does it. */
function typeInto(value: string): void {
  const element = document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]')!;
  element.value = value;
  fireEvent.input(element, { target: { value } });
  act(() => {
    drainFrames();
  });
}

let doc: Y.Doc;
let id: string;

beforeEach(() => {
  cleanup();
  doc = new Y.Doc();
  initDoc(doc);
  id = createText(doc, { x: 100, y: 100 }, 'g_me') as string;
});

function mount(): void {
  render(<Harness doc={doc} id={id} />);
  act(() => {
    drainFrames();
  });
}

describe('text.sync: my change writes the box', () => {
  it('TC-12 writes the measured box once, when I change the text', () => {
    mount();
    const writes = countWrites(doc);

    typeInto('hello');

    // One transaction for the five characters, one for the box. Nothing else.
    expect(writes.local()).toBe(2);
    expect(writes.remote()).toBe(0);
    expect(storedBox(doc, id)).toEqual(boxOf('hello'.length));
    writes.stop();
  });

  it('TC-12 writes nothing when the change came from somebody else', () => {
    mount();
    const peer = createPeer(doc);
    const before = storedBox(doc, id);
    const writes = countWrites(doc);

    peer.transact((theirDoc) => {
      getTextContent(theirDoc, id)?.insert(0, 'somebody else typed this');
    });
    act(() => {
      drainFrames();
    });

    // The text arrived, and the box that arrived with it stands untouched.
    expect(getTextContent(doc, id)?.toString()).toBe('somebody else typed this');
    expect(writes.local()).toBe(0);
    expect(writes.remote()).toBe(1);
    expect(storedBox(doc, id)).toEqual(before);
    writes.stop();
  });

  it('TC-13 measures again and writes nothing when the box is already right', () => {
    mount();
    typeInto('hello');
    const before = storedBox(doc, id);
    const writes = countWrites(doc);

    // The same measurement twice over: the second one is not an update.
    act(() => {
      remeasureTextBox(doc, id, measure);
      remeasureTextBox(doc, id, measure);
    });

    expect(writes.local()).toBe(0);
    expect(storedBox(doc, id)).toEqual(before);

    // And a keystroke that does not change the shape of the text - a character
    // removed and another put in its place, of the same width - is the text
    // alone: the box it measured is the box the object already has.
    typeInto('jello');
    expect(writes.local()).toBe(1);
    writes.stop();
  });

  it('writes one box for a whole paste, not one per character', () => {
    mount();
    const writes = countWrites(doc);

    // One `input` event is one commit and one measurement, however long it is.
    typeInto('a pasted line of text that is fairly long');

    expect(writes.local()).toBe(2);
    expect(storedBox(doc, id).height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    writes.stop();
  });

  it('follows the size: XL is measured at the larger font size', () => {
    mount();
    typeInto('hello');
    const small = storedBox(doc, id);

    const writes = countWrites(doc);
    // What the text toolbar does: the size, then the box, in that order.
    act(() => {
      setTextSize(doc, id, 'XL');
      remeasureTextBox(doc, id, measure);
    });

    expect(writes.local()).toBe(2);
    expect(storedBox(doc, id)).toEqual({
      width: boxOf('hello'.length, 'XL').width,
      height: boxOf('hello'.length, 'XL').height,
    });
    expect(storedBox(doc, id).width).toBeGreaterThan(small.width);
    expect(storedBox(doc, id).height).toBeGreaterThan(small.height);
    writes.stop();
  });

  it('keeps a fixed width and grows only the height', () => {
    mount();
    typeInto('word one two');
    act(() => {
      setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
      remeasureTextBox(doc, id, measure);
    });
    const fixed = storedBox(doc, id);
    // 20 board units a character in a 40-unit box: one word to a line.
    expect(fixed.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(fixed.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(mapOf(doc, id).get('widthMode')).toBe('fixed');

    // Measuring a fixed-width object does not quietly put it back to automatic.
    const writes = countWrites(doc);
    act(() => {
      remeasureTextBox(doc, id, measure);
    });
    expect(writes.local()).toBe(0);
    expect(mapOf(doc, id).get('widthMode')).toBe('fixed');
    writes.stop();
  });

  it('writes nothing on mount, so a board that received an object stays quiet', () => {
    const peer = createPeer(doc);
    const theirs = peer.transact((theirDoc) => createText(theirDoc, { x: 1, y: 2 }, 'g_them'));
    act(() => {
      drainFrames();
    });
    const writes = countWrites(doc);

    mount();
    mount();

    // Two clients mounting the same object is still no traffic at all.
    expect(theirs).toBeTruthy();
    expect(mapOf(doc, id).get('type')).toBe(TEXT_TYPE);
    expect(writes.local()).toBe(0);
    writes.stop();
  });

  it('leaves an object that is not a text object alone', () => {
    const foreign = new Y.Map<unknown>();
    foreign.set(OBJECT_FIELDS.type, 'frame');
    doc.getMap<Y.Map<unknown>>('objects').set('g_foreign', foreign);
    const writes = countWrites(doc);

    expect(remeasureTextBox(doc, 'g_foreign', measure)).toBe(false);
    expect(remeasureTextBox(doc, 'g_missing', measure)).toBe(false);
    expect(writes.local()).toBe(0);
    writes.stop();
  });
});
