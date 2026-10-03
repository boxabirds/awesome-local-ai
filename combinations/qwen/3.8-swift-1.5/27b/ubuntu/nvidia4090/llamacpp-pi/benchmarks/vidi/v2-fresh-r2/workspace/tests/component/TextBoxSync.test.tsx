/**
 * Component tests for the local-only text box sync (text.layout).
 * TC-12: remote changes produce NO local setTextBox writes; a local change
 *        produces exactly one write with the measured box.
 * TC-13: a local change whose remeasured box equals the stored box produces
 *        no write; an auto→fixed transition writes a new height once.
 *
 * A peer Y.Doc joins the board (receiving the existing state, like a real
 * participant) and edits the shared text; its changes are pushed to the
 * local doc under a 'peer' origin. Local edits use LOCAL_ORIGIN. Box writes
 * are counted by observing the object's width/height fields.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import * as Y from 'yjs';
import { render, act } from '@testing-library/react';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, setTextWidthFixed, getTextContent } from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { layoutText, type Measurer } from '../../src/client/objects/textLayout';

/** Deterministic fake measurer: 10 world units per non-space character. */
const measure: Measurer = (text: string) => text.replace(/ /g, '').length * 10;

/** Minimal probe that mounts the box-sync hook for one text object. */
function Probe({ doc, id }: { doc: Y.Doc; id: string }) {
  useTextBoxSync(doc, id, measure);
  return null;
}

/**
 * A peer doc that has joined the board: it received the existing state, so
 * it references the same text object. `push` applies the peer's pending
 * changes to `doc` under a 'peer' origin (what the network layer does).
 */
function makePeer(doc: Y.Doc, id: string): { peerText: Y.Text; push: () => void } {
  const peer = new Y.Doc();
  initDoc(peer);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), 'peer');
  const peerText = (peer.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
  return {
    peerText,
    push: () => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)), 'peer');
    },
  };
}

/**
 * Observe box writes on a text object. `writes` is every width/height write;
 * `heightChanges` is the subset that changed the stored height (the
 * remeasure writes — a width drag's own width write does not count).
 */
function trackBoxWrites(doc: Y.Doc, id: string): {
  writes: Array<{ width: number; height: number }>;
  heightChanges: Array<{ width: number; height: number }>;
  stop(): void;
} {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
  const writes: Array<{ width: number; height: number }> = [];
  const heightChanges: Array<{ width: number; height: number }> = [];
  let lastHeight = (obj.get('height') as number) ?? 0;
  const handler = (event: Y.YMapEvent<unknown>) => {
    if (!event.keys.has('width') && !event.keys.has('height')) return;
    const width = obj.get('width') as number;
    const height = obj.get('height') as number;
    writes.push({ width, height });
    if (height !== lastHeight) {
      heightChanges.push({ width, height });
      lastHeight = height;
    }
  };
  obj.observe(handler);
  return { writes, heightChanges, stop: () => obj.unobserve(handler) };
}

function readBox(doc: Y.Doc, id: string): { width: number; height: number } {
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
  return { width: obj.get('width') as number, height: obj.get('height') as number };
}

const unmounts: Array<() => void> = [];
afterEach(() => {
  while (unmounts.length) unmounts.pop()!();
});

describe('text box sync (component)', () => {
  // TC-12: remote text change → zero local writes; local change → exactly
  // one write with the measured box.
  it('TC-12: remote changes write nothing; a local change writes the measured box once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    const { unmount } = render(<Probe doc={doc} id={id} />);
    unmounts.push(unmount);
    const tracker = trackBoxWrites(doc, id);

    // A remote peer types into the shared text.
    const { peerText, push } = makePeer(doc, id);
    act(() => {
      peerText.insert(0, 'hello');
      push();
    });
    expect(getTextContent(doc, id)!.toString()).toBe('hello');
    expect(tracker.writes).toHaveLength(0); // no local dimension write

    // A local edit (transacted with LOCAL_ORIGIN, like the editor does):
    // exactly one write, with the measured box.
    tracker.writes.length = 0;
    const localText = getTextContent(doc, id)!;
    act(() => {
      doc.transact(() => {
        localText.insert(localText.length, ' world');
      }, LOCAL_ORIGIN);
    });
    expect(tracker.writes).toHaveLength(1);
    const expected = layoutText('hello world', 'M', 'auto', null, measure);
    expect(tracker.writes[0]).toEqual({ width: expected.width, height: expected.height });
    expect(readBox(doc, id)).toEqual({ width: expected.width, height: expected.height });
    tracker.stop();
  });

  // TC-13: a local change that does not alter the layout inputs (no text,
  // size, mode or fixed-width change) writes nothing; an auto→fixed width
  // change writes the remeasured box exactly once.
  it('TC-13: redundant local changes write nothing; a width change writes once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;

    const { unmount } = render(<Probe doc={doc} id={id} />);
    unmounts.push(unmount);

    // Type some text locally so the box is measured and stored.
    const text = getTextContent(doc, id)!;
    act(() => {
      doc.transact(() => {
        text.insert(0, 'abcd efgh ijkl'); // three 4-letter words
      }, LOCAL_ORIGIN);
    });
    const afterType = readBox(doc, id);
    const typedLayout = layoutText('abcd efgh ijkl', 'M', 'auto', null, measure);
    expect(afterType).toEqual({ width: typedLayout.width, height: typedLayout.height });

    const tracker = trackBoxWrites(doc, id);

    // A local update that does NOT touch text/size/widthMode (a z-order
    // bump) must not produce a box write.
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    act(() => {
      doc.transact(
        () => {
          obj.set('z', (obj.get('z') as number) + 1);
        },
        LOCAL_ORIGIN,
      );
    });
    expect(tracker.writes).toHaveLength(0);
    expect(readBox(doc, id)).toEqual(afterType);

    // auto → fixed: a side-handle drag sets the fixed width; the height is
    // remeasured and written exactly once (the drag's own width write does
    // not count as a remeasure).
    act(() => {
      setTextWidthFixed(doc, id, 40);
    });
    const expected = layoutText('abcd efgh ijkl', 'M', 'fixed', 40, measure);
    expect(tracker.heightChanges).toHaveLength(1);
    expect(tracker.heightChanges[0]).toEqual({ width: expected.width, height: expected.height });
    const after = readBox(doc, id);
    expect(after.width).toBe(40);
    expect(after.height).toBe(expected.height);
    tracker.stop();
  });
});
