// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import type { Measurer } from '../../src/client/objects/textLayout';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { flushFrames } from './fixtures/board';

/**
 * The rule behind design key decision 1 (text.layout): a text object's box is stored, and
 * only the client that just changed something locally measures and writes it. Nobody else
 * touches it — not when a change arrives from another person, and not when a change turns
 * out to need the same box it already had.
 *
 * Two real documents are linked the way a room would link them, so "remote" means what it
 * says: an update from another document, applied without a local origin. A component that
 * does nothing but hold the hook is mounted, so a leak from an observer or an effect would
 * show up as a write.
 */

const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;
const at = { x: 0, y: 0 };

/** What the document holds, read off the map rather than through the clamping snapshot. */
function storedBox(doc: Y.Doc, id: string): { width: number; height: number } {
  const item = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!item) throw new Error(`no object with id ${id}`);
  return { width: item.get('width') as number, height: item.get('height') as number };
}

/**
 * Every transaction that left a different box on the object counts as one write. Both the
 * text and the box are in one entry, so this sees a box write and only a box write.
 */
function boxesWritten(doc: Y.Doc, id: string): {
  written: () => Array<{ width: number; height: number }>;
  reset: () => void;
} {
  const writes: Array<{ width: number; height: number }> = [];
  let before = storedBox(doc, id);
  doc.on('afterTransaction', () => {
    const after = storedBox(doc, id);
    if (after.width !== before.width || after.height !== before.height) writes.push(after);
    before = after;
  });
  return {
    written: () => writes.slice(),
    reset: () => {
      writes.length = 0;
      before = storedBox(doc, id);
    },
  };
}

const RELAY = 'relay';

/** Hand updates between two documents in both directions, once each. */
function link(a: Y.Doc, b: Y.Doc): void {
  const forward = (from: Y.Doc, to: Y.Doc): void => {
    from.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === RELAY) return;
      Y.applyUpdate(to, update, RELAY);
    });
  };
  forward(a, b);
  forward(b, a);
}

interface SyncApi {
  remeasureAfterLocalChange(): void;
}

/** The only thing this component does is hold the hook a text object holds. */
function BoxSync({
  doc,
  id,
  api,
}: {
  doc: Y.Doc;
  id: string;
  api: { current: SyncApi | null };
}): ReactNode {
  const synced = useTextBoxSync(doc, id, measure);
  useEffect(() => {
    api.current = synced;
  }, [synced]);
  return null;
}

/**
 * A text object created in the peer's document and synced over, with a client holding the
 * box sync for it. The peer made it, so its box is the one a new text always starts with.
 */
function mountText(text?: string): {
  local: Y.Doc;
  peer: Y.Doc;
  id: string;
  api: { current: SyncApi | null };
  boxes: { written: () => Array<{ width: number; height: number }>; reset: () => void };
} {
  const local = new Y.Doc();
  const peer = new Y.Doc();
  link(local, peer);
  const api = { current: null as SyncApi | null };

  let id: string | null = null;
  act(() => {
    id = createText(peer, at, 'g_peer');
    const ytext = id !== null ? getTextContent(peer, id) : undefined;
    if (text && ytext) ytext.insert(0, text);
  });
  if (id === null) throw new Error('the peer created no text');

  const created = id;
  render(<BoxSync doc={local} id={created} api={api} />);
  return { local, peer, id: created, api, boxes: boxesWritten(local, created) };
}

/** Type into the local document the way the editor does: as this client's own work. */
function typeLocally(doc: Y.Doc, id: string, text: string): void {
  act(() => {
    const ytext = getTextContent(doc, id);
    if (!ytext) throw new Error(`no text object with id ${id}`);
    doc.transact(() => ytext.insert(ytext.toString().length, text), LOCAL_ORIGIN);
  });
}

function remeasure(api: { current: SyncApi | null }): void {
  act(() => {
    if (!api.current) throw new Error('the box sync is not mounted');
    api.current.remeasureAfterLocalChange();
  });
}

describe('who measures a text object (TC-12)', () => {
  it('TC-12: a remote change costs no box write; a local one costs exactly one', async () => {
    const { local, peer, id, api, boxes } = mountText();
    const untouched = storedBox(local, id);
    expect(untouched.width).toBe(TEXT_MIN_WIDTH_WORLD); // the box a new text starts with

    // Another person types 101 characters in words: 1,010 units of text, and this screen
    // would measure it differently again.
    const typed = Array(17).fill('xxxxx').join(' ');
    expect(typed.length).toBe(101);
    act(() => {
      const ytext = getTextContent(peer, id);
      if (!ytext) throw new Error('no text object in the peer document');
      peer.transact(() => ytext.insert(0, typed), 'g_peer');
    });
    await flushFrames();
    await flushFrames();

    // Nothing was rewritten here: the box in the document is still the peer's, and this
    // client only draws it (design key decision 1).
    expect(boxes.written()).toEqual([]);
    expect(storedBox(local, id)).toEqual(untouched);

    // Now this client types, and remeasures as it does: one write, the measured box. A
    // hundred and two characters at ten units is 1,020 units, so 600 wide over two lines.
    typeLocally(local, id, 'x');
    remeasure(api);
    await flushFrames();

    const written = boxes.written();
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({
      width: 600,
      height: 2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });
    expect(storedBox(local, id).width).toBe(600);
  });
});

describe('a change that needs no box write (TC-13)', () => {
  it('TC-13: when the remeasured box equals the stored one, nothing is written', () => {
    const { local, id, api, boxes } = mountText('aaaaa'); // five characters: 50 units
    remeasure(api);
    expect(boxes.written()).toEqual([{ width: 58, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT }]);

    // The size it already has: the model refuses it, and remeasuring agrees with the box.
    expect(setTextSize(local, id, 'M')).toBe(false);
    remeasure(api);
    expect(boxes.written()).toHaveLength(1);

    // A size that really is different writes once, and then the same box again writes
    // nothing at all.
    expect(setTextSize(local, id, 'S')).toBe(true);
    remeasure(api);
    const smaller = boxes.written();
    expect(smaller).toHaveLength(2);
    expect(smaller[1]).toEqual({ width: 43, height: TEXT_SIZES.S * TEXT_LINE_HEIGHT });
    remeasure(api);
    expect(boxes.written()).toHaveLength(2);
  });

  it('a width drag fixes the width and rewraps, writing the new height once', () => {
    const words = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff'];
    const { local, id, api, boxes } = mountText(words.join(' '));

    remeasure(api);
    // Automatic: 35 characters is 350 units, one line, plus the padding.
    expect(boxes.written()[0]).toEqual({ width: 358, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });

    // From here the box the handle asks for and the box the content needs are written
    // separately: `setTextWidthFixed` stores the width, and the remeasure that follows
    // stores the height it rewrapped to — one box write, no more.
    boxes.reset();
    expect(setTextWidthFixed(local, id, 100)).toBe(true);
    remeasure(api);
    const written = boxes.written();
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual({ width: 100, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });
    // Fixed at 100 units, one five-character word fits a line, so six lines.
    expect(written[1]).toEqual({ width: 100, height: 6 * TEXT_SIZES.M * TEXT_LINE_HEIGHT });
  });
});
