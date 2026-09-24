/**
 * Story 9 · task 5 — box-sync component tests (TC-12, TC-13).
 *
 * The local-only write rule is checked with two **real** `Y.Doc`s synced through
 * an update bridge (the same mechanism the websocket provider uses), a fake
 * measurer, and direct reads of the stored box. A remote peer's text change must
 * produce **zero** local box writes (TC-12, negative); a local change writes
 * exactly one box; a remeasure whose box equals the stored box writes nothing
 * (TC-13, negative — no redundant updates).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createText, getTextContent, setTextSize } from '../../src/shared/objects/text';
import {
  createTextBoxSync,
  type BoxMeasurer,
} from '../../src/client/objects/useTextBoxSync';
import { layoutText } from '../../src/client/objects/textLayout';
import type { TextSize } from '../../src/shared/config';

/** A fake measurer: width is a fixed number of world units per character. */
const perChar = (unit: number): BoxMeasurer => (text) => text.length * unit;

const layout = (
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: BoxMeasurer,
) => layoutText(text, size, mode, fixedWidth, measure);

/** Keep two docs in sync both ways, like the websocket provider would. */
function bridge(a: Y.Doc, b: Y.Doc): void {
  const onA = (update: Uint8Array, origin: unknown) => {
    if (origin !== b) Y.applyUpdate(b, update, a);
  };
  const onB = (update: Uint8Array, origin: unknown) => {
    if (origin !== a) Y.applyUpdate(a, update, b);
  };
  a.on('update', onA);
  b.on('update', onB);
}

function boxOf(doc: Y.Doc, id: string): { width: number; height: number } {
  const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
  return { width: record.get('width') as number, height: record.get('height') as number };
}

describe('useTextBoxSync (TC-12)', () => {
  it('a remote text change leaves the local box untouched (negative)', () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    bridge(local, remote);
    const id = createText(local, { x: 0, y: 0 }, 'me')!;
    const sync = createTextBoxSync(local, id, perChar(6), layout);
    sync.remeasureAfterLocalChange(); // establish a box from the empty content

    const before = boxOf(local, id);
    const remoteText = getTextContent(remote, id)!;

    // The peer types; the update converges into the local doc. Nothing on the
    // remote path calls `remeasureAfterLocalChange`, so the box must not change.
    remoteText.insert(0, 'hello world');
    const after = boxOf(local, id);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    // The text itself did converge (the change reached us, we just did not write
    // a box for it).
    expect(getTextContent(local, id)!.toString()).toBe('hello world');
  });

  it('a local text change writes exactly one box (the measured width)', () => {
    const local = new Y.Doc();
    const id = createText(local, { x: 0, y: 0 }, 'me')!;
    const sync = createTextBoxSync(local, id, perChar(6), layout);
    const text = getTextContent(local, id)!;
    text.insert(0, 'hello'); // 5 chars → 30 world units, one line
    expect(sync.remeasureAfterLocalChange()).toBe(true);
    expect(boxOf(local, id).width).toBeCloseTo(30, 3);
  });
});

describe('useTextBoxSync (TC-13)', () => {
  it('re-running with an unchanged box writes nothing (negative)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'me')!;
    const sync = createTextBoxSync(doc, id, perChar(6), layout);
    const text = getTextContent(doc, id)!;
    text.insert(0, 'a');
    expect(sync.remeasureAfterLocalChange()).toBe(true);
    // Nothing changed between this call and the next: the box already matches,
    // so `setTextBox` must refuse (no redundant update / sync traffic).
    expect(sync.remeasureAfterLocalChange()).toBe(false);
  });

  it('a size change that grows the box writes it once, then stays quiet', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'me')!;
    const sync = createTextBoxSync(doc, id, perChar(6), layout);
    const text = getTextContent(doc, id)!;
    text.insert(0, 'a');
    sync.remeasureAfterLocalChange();
    const smallBox = boxOf(doc, id);

    // A bigger preset makes one line taller: the remeasure writes the new box.
    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(sync.remeasureAfterLocalChange()).toBe(true);
    expect(boxOf(doc, id).height).toBeGreaterThan(smallBox.height);
    // Now the stored box already matches the XL content: a second remeasure is a
    // no-op.
    expect(sync.remeasureAfterLocalChange()).toBe(false);
  });
});
