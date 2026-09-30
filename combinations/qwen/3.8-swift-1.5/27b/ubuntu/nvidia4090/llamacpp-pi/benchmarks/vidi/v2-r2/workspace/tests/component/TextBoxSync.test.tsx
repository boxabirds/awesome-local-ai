/**
 * Story 9: box sync component tests (TC-12, TC-13). The sync hook must write a
 * box only in response to local changes — never for remote updates, and never
 * redundantly when the measured box is unchanged.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { renderHook, act } from '@testing-library/react';
import { initDoc } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';

/** Same deterministic measurer as the layout unit tests (10 units/char at M). */
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** Keeps two docs in sync both directions (origin 'sync', not LOCAL). */
function syncDocs(a: Y.Doc, b: Y.Doc): void {
  const aToB = (update: Uint8Array) => Y.applyUpdate(b, update, 'sync');
  const bToA = (update: Uint8Array) => Y.applyUpdate(a, update, 'sync');
  a.on('update', aToB);
  b.on('update', bToA);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'sync');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'sync');
}

function makePair(): { local: Y.Doc; remote: Y.Doc } {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  initDoc(local);
  initDoc(remote);
  syncDocs(local, remote);
  return { local, remote };
}

interface BoxCounters {
  boxWrites: number; // a width or height value actually changed
  heightWrites: number; // the height value actually changed
}

/**
 * Counts box writes on the object (set up after creation, so the initial
 * estimated box is not counted). A Yjs map observer fires for every `set` in a
 * transaction — even unchanged values — so we compare each key's oldValue with
 * its current map value and count only genuine value changes.
 */
function countBoxWrites(doc: Y.Doc, id: string): BoxCounters {
  const counters: BoxCounters = { boxWrites: 0, heightWrites: 0 };
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
  obj.observe((event) => {
    let widthChanged = false;
    let heightChanged = false;
    // Yjs change descriptors carry only `oldValue`; the new value is read from
    // the map (the observer runs after the transaction, so it is current).
    for (const key of event.keys.keys()) {
      if (key !== 'width' && key !== 'height') continue;
      const change = event.changes.keys.get(key);
      if (!change) continue;
      if (change.oldValue === obj.get(key)) continue;
      if (key === 'width') widthChanged = true;
      if (key === 'height') heightChanged = true;
    }
    if (widthChanged || heightChanged) counters.boxWrites++;
    if (heightChanged) counters.heightWrites++;
  });
  return counters;
}

describe('useTextBoxSync (ui-component)', () => {
  it('TC-12: remote text change → no writes; local change → exactly one setTextBox', () => {
    const { local, remote } = makePair();
    const id = createText(local, { x: 0, y: 0 }, 'g')!;
    const { result } = renderHook(() => useTextBoxSync(local, id, fakeMeasure));
    const c = countBoxWrites(local, id);

    // A remote peer edits the text; it syncs to the local doc. The hook must
    // not write a box in response to a remote change.
    act(() => {
      getTextContent(remote, id)!.insert(0, 'hello');
    });
    // The remote edit synced to the local doc.
    expect(getTextContent(local, id)!.toString()).toBe('hello');
    expect(c.boxWrites).toBe(0);

    // A local edit, followed by a local remeasure → exactly one box write.
    act(() => {
      getTextContent(local, id)!.insert(0, 'world');
      result.current.remeasureAfterLocalChange();
    });
    expect(c.boxWrites).toBe(1);
  });

  it('TC-13: no redundant write when unchanged; auto→fixed rewrap writes new height once', () => {
    const { local } = makePair();
    const id = createText(local, { x: 0, y: 0 }, 'g')!;
    getTextContent(local, id)!.insert(0, 'hello world foo bar');
    const { result } = renderHook(() => useTextBoxSync(local, id, fakeMeasure));
    const c = countBoxWrites(local, id);

    // First remeasure writes the auto box (width grows from the estimate).
    act(() => result.current.remeasureAfterLocalChange());
    const afterFirst = c.boxWrites;
    expect(afterFirst).toBe(1);

    // Second remeasure with nothing changed → no redundant write.
    act(() => result.current.remeasureAfterLocalChange());
    expect(c.boxWrites).toBe(afterFirst);

    // Drag to a fixed (small) width, then remeasure: the text rewraps and the
    // new height is written exactly once.
    act(() => {
      setTextWidthFixed(local, id, TEXT_MIN_WIDTH_WORLD);
      result.current.remeasureAfterLocalChange();
    });
    expect(c.heightWrites).toBe(1);
  });
});
