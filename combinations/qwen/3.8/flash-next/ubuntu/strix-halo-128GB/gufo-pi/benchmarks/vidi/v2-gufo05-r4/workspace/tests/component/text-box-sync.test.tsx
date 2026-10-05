/**
 * Story 9 component tests for keeping a text box measured (`text.layout`): TC-12 and
 * TC-13.
 *
 * The rule under test is *who* writes a text object's `width` and `height`. Only the
 * client that changed the text measures it: five people looking at one text must not
 * each write their own idea of how wide a word is, so a remote change is drawn with the
 * box its author stored and never re-measured here.
 *
 * A real second `Y.Doc` plays the other person (as in the story 4 undo tests), so the
 * origins under test are the real ones — `LOCAL_ORIGIN` for our own work, the provider's
 * for theirs.
 */

import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { boardObjects, LOCAL_ORIGIN, objectMap } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextBox,
  type TextSnapshot
} from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../src/shared/config';
import { connectPeer, PROVIDER_ORIGIN } from '../unit/helpers/peer';

/** Half a character wide, like the layout unit tests: no font, no guessing. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** The box this fake measurer says `text` needs at `size`, in auto mode. */
function expectedBox(text: string, size: TextSize): { width: number; height: number } {
  const fontPx = TEXT_SIZES[size];
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((line) => line.length));
  return { width: longest * fontPx * 0.5, height: lines.length * fontPx * TEXT_LINE_HEIGHT };
}

interface Probe {
  remeasure(): void;
}

/** The hook, held open by a component, with its method handed to the test. */
function renderProbe(doc: Y.Doc, id: string, into: Probe): void {
  function Text(): null {
    const sync = useTextBoxSync(doc, id, measure);
    into.remeasure = () => sync.remeasureAfterLocalChange();
    return null;
  }
  render(<Text />);
}

/** A text box write is a change to `width` or `height` on an object. */
interface BoxWrite {
  id: string;
  origin: unknown;
}

/** The box writes this client made itself, as opposed to the ones it was told about. */
function ours(writes: BoxWrite[]): BoxWrite[] {
  return writes.filter((write) => write.origin === LOCAL_ORIGIN);
}

/**
 * Is this event about the keys of a map? Asked structurally, because yjs declares
 * `MapEvent` in its types and does not export it at runtime.
 */
function keyChangesOf(event: Y.YEvent<Y.AbstractType<unknown>>): Map<string, unknown> | null {
  const keys = (event as unknown as { changes?: { keys?: unknown } }).changes?.keys;
  return keys instanceof Map ? (keys as Map<string, unknown>) : null;
}

function boxWritesOn(doc: Y.Doc): BoxWrite[] {
  const writes: BoxWrite[] = [];
  doc.getMap('objects').observeDeep((events, transaction) => {
    for (const event of events) {
      const keys = keyChangesOf(event);
      if (!keys) continue; // a `Y.Text` event, or a deep event with no keys of its own
      if (!keys.has('width') && !keys.has('height')) continue;
      const object = event.target as unknown as Y.Map<unknown>;
      writes.push({ id: String(object.get('id')), origin: transaction.origin });
    }
  });
  return writes;
}

/** Let the measurement scheduled on a microtask run, inside React's world. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function stored(doc: Y.Doc, id: string): TextSnapshot {
  const found = boardObjects(doc).find((object) => object.id === id) as TextSnapshot | undefined;
  if (!found) throw new Error(`object ${id} is not on the board`);
  return found;
}

describe('who measures a text box (text.layout)', () => {
  afterEach(cleanup);

  it('TC-12: a local change measures once, a remote change not at all', async () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_me')!;
    const peer = connectPeer(doc);
    const probe: Probe = { remeasure: () => {} };
    renderProbe(doc, id, probe);

    const writes = boxWritesOn(doc);

    // Our own typing: exactly one write, holding the box our measurer produced.
    const text = getTextContent(doc, id)!;
    await act(async () => {
      doc.transact(() => text.insert(0, 'Went well'), LOCAL_ORIGIN);
    });
    await settle();

    expect(ours(writes)).toHaveLength(1);
    expect({ width: stored(doc, id).width, height: stored(doc, id).height }).toEqual(
      expectedBox('Went well', 'M')
    );

    // The other person types into the same text and stores their own box with it —
    // their font, their numbers, their measurement.
    await act(async () => {
      peer.change((peerDoc) => {
        peerDoc.transact(() => {
          const objects = peerDoc.getMap<Y.Map<unknown>>('objects');
          const peerText = objects.get(id)!.get('text') as Y.Text;
          peerText.insert(peerText.length, ' on Tuesday');
          const peerObject = objects.get(id)!;
          peerObject.set('width', 612);
          peerObject.set('height', 111);
        });
      });
    });
    await settle();

    // Their text is drawn with their box: no further local write, and 612 x 111 stands.
    expect(ours(writes)).toHaveLength(1);
    expect(stored(doc, id).text).toBe('Went well on Tuesday');
    expect({ width: stored(doc, id).width, height: stored(doc, id).height }).toEqual({
      width: 612,
      height: 111
    });
  });

  it('a remote delete leaves nothing to measure', async () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_me')!;
    const peer = connectPeer(doc);
    const probe: Probe = { remeasure: () => {} };
    renderProbe(doc, id, probe);
    const writes = boxWritesOn(doc);

    await act(async () => {
      peer.change((peerDoc) => {
        peerDoc.getMap('objects').delete(id);
      });
    });
    await settle();

    expect(writes).toEqual([]);
    expect(objectMap(doc, id)).toBeUndefined();
    // Measuring a text that is gone is a no-op rather than a throw.
    expect(() => probe.remeasure()).not.toThrow();
    expect(writes).toEqual([]);
  });

  it('TC-13: a size change is measured once locally, and the box travels with it', async () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_me')!;
    const text = getTextContent(doc, id)!;
    doc.transact(() => text.insert(0, 'Went well'), LOCAL_ORIGIN);
    setTextBox(doc, id, expectedBox('Went well', 'M'));

    const peer = connectPeer(doc);
    const probe: Probe = { remeasure: () => {} };
    renderProbe(doc, id, probe);
    const localWrites = boxWritesOn(doc);
    const peerWrites = boxWritesOn(peer.doc);

    // The model does not measure: a bigger size with no remeasure leaves the box alone,
    // which keeps exactly one code path that decides what a text box is.
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect({ width: stored(doc, id).width, height: stored(doc, id).height }).toEqual(
      expectedBox('Went well', 'M')
    );
    expect(ours(localWrites)).toHaveLength(0);

    // What the toolbar does after a size change: measure once.
    probe.remeasure();
    await settle();

    expect(ours(localWrites)).toHaveLength(1);
    expect({ width: stored(doc, id).width, height: stored(doc, id).height }).toEqual(
      expectedBox('Went well', 'XL')
    );
    expect(stored(doc, id).size).toBe('XL');

    // The other client received text, size and box, and wrote nothing itself.
    expect(stored(peer.doc, id).size).toBe('XL');
    expect({ width: stored(peer.doc, id).width, height: stored(peer.doc, id).height }).toEqual(
      expectedBox('Went well', 'XL')
    );
    // Every box number the other side ever had arrived from here; it measured nothing
    // of its own, which is the whole point of one writer.
    expect(peerWrites.filter((write) => write.origin !== PROVIDER_ORIGIN)).toEqual([]);

    // A size arriving from the other side is drawn, not re-measured.
    await act(async () => {
      peer.change((peerDoc) => setTextSize(peerDoc, id, 'S'));
    });
    await settle();

    expect(stored(doc, id).size).toBe('S');
    expect(ours(localWrites)).toHaveLength(1);
  });

  it('a remeasure that agrees with the document writes nothing', async () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_me')!;
    const probe: Probe = { remeasure: () => {} };
    renderProbe(doc, id, probe);
    const writes = boxWritesOn(doc);

    probe.remeasure();
    probe.remeasure();
    probe.remeasure();
    await settle();

    // The box an empty text measures to is the box it was created with.
    expect(writes).toEqual([]);
  });
});
