import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { render } from '@testing-library/react';
import type { JSX } from 'react';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, setTextSize, setTextWidthFixed } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';
import { TEXT_MIN_WIDTH_WORLD, TEXT_LINE_HEIGHT, TEXT_SIZES, TEXT_PADDING_X_WORLD } from '../../src/shared/config';

/** Deterministic fake measurer: fontPx / 2 world units per character (10 at M). */
const fake: Measurer = (text, fontPx) => text.length * (fontPx / 2);

/**
 * Count box-key writes on a text object's Y.Map. The trigger calls
 * (setTextSize / setTextWidthFixed / z bumps) change non-box keys, so
 * counting width+height isolates the hook's setTextBox writes. Pass a
 * narrower key set when the trigger itself touches one box key.
 */
function countBoxWrites(doc: Y.Doc, id: string, keys: string[] = ['width', 'height']): () => number {
  let count = 0;
  const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
  const handler = (event: { changes: { keys: Map<string, unknown> } }): void => {
    for (const key of keys) {
      if (event.changes.keys.has(key)) {
        count++;
        break;
      }
    }
  };
  obj.observe(handler);
  return () => {
    obj.unobserve(handler);
    return count;
  };
}

function Harness({ doc, id }: { doc: Y.Doc; id: string }): JSX.Element {
  useTextBoxSync(doc, id, fake);
  return <div data-vidi6="box-sync-harness" />;
}

describe('useTextBoxSync: local-only box writes (story 9)', () => {
  // TC-12
  it('TC-12: remote text change → zero box writes', () => {
    const localDoc = new Y.Doc();
    initDoc(localDoc);
    const id = createText(localDoc, { x: 0, y: 0 }, 'g_test')!;
    // Put some text in so the box is non-trivial
    applyTextDiff((localDoc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text, 'hello', LOCAL_ORIGIN);

    const { unmount } = render(<Harness doc={localDoc} id={id} />);
    const stopCounting = countBoxWrites(localDoc, id);
    expect(stopCounting()).toBe(0);

    // Remote change: a second doc edits the text and the update is applied to
    // the local doc with a remote origin (not LOCAL_ORIGIN).
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(localDoc));
    const remoteText = (remoteDoc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
    applyTextDiff(remoteText, 'hello world', 'remote-peer');
    const delta = Y.encodeStateAsUpdate(remoteDoc, Y.encodeStateVector(localDoc));
    Y.applyUpdate(localDoc, delta);

    expect(((localDoc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text).toString()).toBe('hello world');
    // No box write from the remote change
    expect(stopCounting()).toBe(0);
    unmount();
  });

  it('TC-12b: local text change → exactly one box write with measured size', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    render(<Harness doc={doc} id={id} />);
    const stopCounting = countBoxWrites(doc, id);

    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
    applyTextDiff(ytext, 'Went well', LOCAL_ORIGIN);

    // Exactly one write
    expect(stopCounting()).toBe(1);

    // The written box matches the fake measurer: 'Went well' = 9 chars × 10 = 90
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(90 + TEXT_PADDING_X_WORLD);
    expect(obj.get('height')).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-13
  it('TC-13: local change whose remeasured box equals the stored box → no write', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;

    render(<Harness doc={doc} id={id} />);
    // Type locally first: the hook writes the box once (34 × 26).
    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);

    // Now that the box is synced, count further writes: a local z-order bump
    // (like a drag's bringObjectsToFront) triggers a remeasure, finds the box
    // unchanged, and writes nothing.
    const stopCounting = countBoxWrites(doc, id);
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    doc.transact(() => {
      obj.set('z', 99);
    }, LOCAL_ORIGIN);

    expect(stopCounting()).toBe(0);
  });

  it('local size change that changes the box → one write, x/y untouched', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);

    render(<Harness doc={doc} id={id} />);
    const stopCounting = countBoxWrites(doc, id);

    expect(setTextSize(doc, id, 'XL')).toBe(true);
    expect(stopCounting()).toBe(1);

    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(3 * 28 + TEXT_PADDING_X_WORLD); // 56/2 per char
    expect(obj.get('height')).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    expect(obj.get('x')).toBe(0);
    expect(obj.get('y')).toBe(0);
  });

  it('auto → fixed transition after a width drag rewraps and writes the new height once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    const ytext = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
    // Three 5-char words at M: one line measures 170 (50+10+50+10+50)
    applyTextDiff(ytext, 'abcde fghij klmno', LOCAL_ORIGIN);

    render(<Harness doc={doc} id={id} />);
    // Count height changes only: the trigger (setTextWidthFixed) itself sets
    // width, so width is excluded from the count.
    const stopCounting = countBoxWrites(doc, id, ['height']);

    // Width drag to the minimum fixed width: rewraps to 3 lines, height grows
    expect(setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD)).toBe(true);
    expect(stopCounting()).toBe(1);

    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(obj.get('width')).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(obj.get('height')).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(obj.get('widthMode')).toBe('fixed');
  });
});
