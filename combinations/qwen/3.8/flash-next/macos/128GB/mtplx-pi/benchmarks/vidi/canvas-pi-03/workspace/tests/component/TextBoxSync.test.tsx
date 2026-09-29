// Story 9, text.layout: who writes a block's box.
//
// The rule under test is design key decision 1 — only the client that made the
// change measures it. Five people on one board must never re-measure the same
// text, and a change that leaves the box the same must not write at all.
// The measurement is a fake measurer (fixed units per character) so the numbers
// below are exact; real fonts are exercised in the e2e suite.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useTextBoxSync, computeTextBox, type TextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { createText, getTextObject, setTextWidthFixed, setTextBox } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

/** Charge `per` world units per character, at any font size. */
function fixedMeasurer(per: number) {
  return (text: string) => text.length * per;
}

/**
 * Watch a doc for transactions that rewrite a block's stored box. That is the
 * thing under test: a *write* of width/height, not a re-render.
 */
function boxWriter(doc: Y.Doc) {
  const writes: Array<{ local: boolean; keys: string[] }> = [];
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    const changed = (tr as unknown as { changed?: Map<Y.AbstractType<unknown>, Set<string>> }).changed;
    if (!changed) return;
    let touched: string[] = [];
    changed.forEach((keys, type) => {
      // A box write lands on the object's own Y.Map, not on the top-level
      // `objects` map, so every changed type has to be asked.
      if (!(type instanceof Y.Map)) return;
      const box = [...keys].filter((k) => k === 'width' || k === 'height');
      if (box.length > 0) touched = box;
    });
    if (touched.length === 0) return;
    writes.push({ local: tr.local, keys: touched });
  });
  return {
    /** Box writes that happened since the last call. */
    since(): Array<{ local: boolean; keys: string[] }> {
      const copy = [...writes];
      writes.length = 0;
      return copy;
    },
  };
}

/** A probe that runs the hook over one block, nothing else. */
function Probe({
  doc,
  id,
  measure,
  api,
}: {
  doc: Y.Doc;
  id: string;
  measure: (text: string, font: { token: string; size: number; family: string; lineHeight: number }) => number;
  api: { current: TextBoxSync | null };
}) {
  const sync = useTextBoxSync(doc, id, measure);
  api.current = sync;
  return null;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function boxOf(doc: Y.Doc, id: string): { width: number; height: number } | null {
  const state = getTextObject(doc, id);
  return state === null ? null : { width: state.width, height: state.height };
}

let doc: Y.Doc;
let peer: Y.Doc;

beforeEach(() => {
  cleanup();
  doc = new Y.Doc();
  peer = new Y.Doc();
  // A stand-in for the sync provider: both docs start from the same state and
  // any update travels both ways.
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
});

/** Sync `from` into `to` the way a received update arrives (not local). */
function relay(from: Y.Doc, to: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
  Y.applyUpdate(to, update);
}

describe('TC-12 only the client that changed the text writes the box', () => {
  it('a remote change writes nothing; a local change writes once', () => {
    const id = createText(doc, { x: 100, y: 100 }, 'local')!;
    const text = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    act(() => {
      doc.transact(() => text.insert(0, 'Went well'), LOCAL_ORIGIN);
    });
    relay(doc, peer);

    const writer = boxWriter(doc);
    const api = { current: null as TextBoxSync | null };
    render(<Probe doc={doc} id={id} measure={fixedMeasurer(10)} api={api} />);
    writer.since(); // the first measure on mount is not part of either case

    // The peer types into its own copy; the update lands here as a remote one.
    const peerText = peer.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    act(() => {
      peer.transact(() => peerText.insert(0, 'Their much longer sentence '));
      relay(peer, doc);
    });
    expect(writer.since()).toEqual([]);

    // A local change does write, and it writes the measured box.
    const before = boxOf(doc, id)!;
    act(() => {
      doc.transact(() => {
        text.insert(0, 'Mine: ');
        api.current!.remeasureAfterLocalChange();
      }, LOCAL_ORIGIN);
    });
    const after = boxOf(doc, id)!;
    expect(after).not.toEqual(before);

    // And the write is exactly one transaction over width/height.
    const writes = writer.since().filter((w) => w.local);
    expect(writes).toHaveLength(1);
    expect(writes[0].keys.sort()).toEqual(['height', 'width']);
  });

  it('a remote change leaves the stored box alone, so peers never fight over it', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'local')!;
    setTextWidthFixed(doc, id, 200);
    const text = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    doc.transact(() => text.insert(0, 'alpha beta gamma delta epsilon zeta eta theta'), LOCAL_ORIGIN);
    relay(doc, peer);

    const writer = boxWriter(doc);
    const api = { current: null as TextBoxSync | null };
    render(<Probe doc={doc} id={id} measure={fixedMeasurer(10)} api={api} />);
    // Mounting measures once — a block needs a box before anything else. That
    // write belongs to neither case, so the ledger starts after it.
    writer.since();
    const settled = boxOf(doc, id)!;
    expect(settled.width).toBe(200);

    const peerText = peer.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    act(() => {
      peer.transact(() => peerText.insert(0, 'a very long remote sentence that would measure very differently '));
      relay(peer, doc);
    });

    // The text arrived; the box did not move. This client only draws what it
    // was sent — it never re-measures a peer's change into its own numbers.
    expect(writer.since()).toEqual([]);
    expect(boxOf(doc, id)).toEqual(settled);
    expect(text.toString()).toContain('a very long remote sentence');
  });
});

describe('TC-13 a remeasure that changes nothing writes nothing', () => {
  it('an equal box is not rewritten', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'local')!;
    const measure = fixedMeasurer(12);
    const text = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;

    // Seed a text whose box is already stored exactly as the measurer computes.
    act(() => {
      doc.transact(() => text.insert(0, 'aaaa'), LOCAL_ORIGIN);
    });
    const first = computeTextBox(doc, id, measure)!;
    act(() => {
      doc.transact(() => setTextBox(doc, id, first), LOCAL_ORIGIN);
    });

    const writer = boxWriter(doc);
    const api = { current: null as TextBoxSync | null };
    render(<Probe doc={doc} id={id} measure={measure} api={api} />);
    writer.since();

    // Same length, same measurement: the content changed, the footprint did not.
    act(() => {
      doc.transact(() => {
        text.delete(0, 4);
        text.insert(0, 'bbbb');
        api.current!.remeasureAfterLocalChange();
      }, LOCAL_ORIGIN);
    });
    expect(writer.since()).toEqual([]);
  });

  it('a fixed-width drag rewraps once, and the next identical remeasure is silent', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'local')!;
    const measure = fixedMeasurer(20);
    const text = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    act(() => {
      doc.transact(() => text.insert(0, 'alpha beta gamma delta'), LOCAL_ORIGIN);
    });

    const writer = boxWriter(doc);
    const api = { current: null as TextBoxSync | null };
    render(<Probe doc={doc} id={id} measure={measure} api={api} />);
    writer.since();

    // Pin the width: height must grow to fit the wrapped text, in one write.
    act(() => {
      doc.transact(() => {
        setTextWidthFixed(doc, id, 100);
        api.current!.remeasureAfterLocalChange();
      }, LOCAL_ORIGIN);
    });
    const pinned = boxOf(doc, id)!;
    expect(pinned.width).toBe(100);
    const afterPin = writer.since().filter((w) => w.local);
    expect(afterPin).toHaveLength(1);

    // Repeat the same operation on unchanged content: nothing to write.
    act(() => {
      doc.transact(() => {
        api.current!.remeasureAfterLocalChange();
      }, LOCAL_ORIGIN);
    });
    expect(writer.since()).toEqual([]);
    expect(boxOf(doc, id)).toEqual(pinned);
    expect(objectsOf(doc).get(id)!.get('widthMode')).toBe('fixed');
  });
});
