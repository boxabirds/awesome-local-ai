/**
 * Story 9 — text.layout (component, TC-12 to TC-13): useTextBoxSync's
 * local-only write rule, with a LOCAL doc and a simulated remote peer
 * (second real Y.Doc relayed with a non-local origin, like the story 3
 * provider) and a deterministic fake measurer (10 world units / char).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
  getTextContent,
} from 'src/shared/objects/text';
import { applyTextDiff } from 'src/shared/text-edit';
import { LOCAL_ORIGIN } from 'src/shared/board-model';
import { useTextBoxSync, remeasureTextBox } from 'src/client/objects/useTextBoxSync';
import type { Measurer } from 'src/client/objects/textLayout';
import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
} from 'src/shared/config';
import { createPeer } from '../unit/peer';

/** Deterministic fake measurer: 10 world units per character. */
const measure: Measurer = (text) => text.length * 10;

function boxOf(doc: Y.Doc, id: string): { width: number; height: number } {
  const obj = doc.getMap('objects').get(id) as Y.Map<Record<string, unknown>>;
  return {
    width: obj.get('width') as unknown as number,
    height: obj.get('height') as unknown as number,
  };
}

/**
 * Counts the object-map write events that touch any of `keys` (each
 * transaction fires one observer event, so this counts setTextBox-style
 * writes, not individual fields).
 */
function countWrites(doc: Y.Doc, id: string, keys: string[]): () => number {
  const obj = doc.getMap('objects').get(id) as Y.Map<Record<string, unknown>>;
  let writes = 0;
  obj.observe((event) => {
    if (keys.some((k) => event.keys.has(k))) writes += 1;
  });
  return () => writes;
}

describe('text.layout box sync (component)', () => {
  beforeEach(() => {
    // nothing shared between tests: each test builds its own docs
  });

  it('TC-12: remote text change → zero box writes; local change → exactly one write', () => {
    const doc = new Y.Doc();
    const peer = createPeer(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    const { result } = renderHook(() => useTextBoxSync(doc, id, measure));

    // The local editor's first measure (empty text → 0×0, differs from the
    // estimate box) is one write.
    act(() => result.current.remeasureAfterLocalChange());
    expect(boxOf(doc, id)).toEqual({ width: 0, height: 0 });

    const writes = countWrites(doc, id, ['width', 'height']);

    // Remote peer types into the SAME text (origin = PEER_ORIGIN, like the
    // story 3 provider): the local client must NOT write dimensions.
    peer.insertText(id, 'Went well');
    expect(
      (doc.getMap('objects').get(id) as Y.Map<Record<string, unknown>>).get('text'),
    ).toBeInstanceOf(Y.Text);
    expect(writes()).toBe(0); // no setTextBox for a remote change

    // A LOCAL change (typing) → exactly one write with the measured box.
    act(() => {
      const ytext = getTextContent(doc, id)!;
      applyTextDiff(ytext, 'Went well!', LOCAL_ORIGIN);
      result.current.remeasureAfterLocalChange();
    });
    expect(writes()).toBe(1);
    expect(boxOf(doc, id)).toEqual({
      width: 10 * 'Went well!'.length, // 100
      height: TEXT_SIZES.M * TEXT_LINE_HEIGHT, // one line
    });
  });

  it('TC-13: remeasure whose box equals the stored box → no write (negative)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const { result } = renderHook(() => useTextBoxSync(doc, id, measure));

    act(() => result.current.remeasureAfterLocalChange()); // empty → 0×0 stored
    const writes = countWrites(doc, id, ['width', 'height']);

    // Empty text measures to the same 0×0 box at ANY size: a local size
    // change whose remeasured box equals the stored box performs no write.
    act(() => {
      setTextSize(doc, id, 'XL');
      result.current.remeasureAfterLocalChange();
    });
    expect(writes()).toBe(0);
    expect(boxOf(doc, id)).toEqual({ width: 0, height: 0 });

    // Second identical remeasure: also no write.
    act(() => result.current.remeasureAfterLocalChange());
    expect(writes()).toBe(0);
  });

  it('auto → fixed transition after a width drag rewraps and writes the new height once', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const { result } = renderHook(() => useTextBoxSync(doc, id, measure));

    // Type (local) and measure: 'abc def ghi' = 11 chars → 110 × 26 box.
    act(() => {
      const ytext = getTextContent(doc, id)!;
      ytext.insert(0, 'abc def ghi');
      result.current.remeasureAfterLocalChange();
    });
    expect(boxOf(doc, id)).toEqual({ width: 110, height: TEXT_SIZES.M * TEXT_LINE_HEIGHT });

    // Height is written only by the remeasure (setTextBox); the drag itself
    // writes width via setTextWidthFixed — so count height writes.
    const writes = countWrites(doc, id, ['height']);

    // Side-handle drag: fixed width 40 → rewrap to one word per line.
    act(() => {
      setTextWidthFixed(doc, id, 40);
      result.current.remeasureAfterLocalChange();
    });
    expect(writes()).toBe(1); // exactly one height rewrite
    expect(boxOf(doc, id)).toEqual({
      width: TEXT_MIN_WIDTH_WORLD,
      height: 3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });
  });

  it('remeasureTextBox is a no-op for stale ids and never throws', () => {
    const doc = new Y.Doc();
    expect(() => remeasureTextBox(doc, 'missing', measure)).not.toThrow();
    expect(remeasureTextBox(doc, 'missing', measure)).toBe(false);
  });
});
