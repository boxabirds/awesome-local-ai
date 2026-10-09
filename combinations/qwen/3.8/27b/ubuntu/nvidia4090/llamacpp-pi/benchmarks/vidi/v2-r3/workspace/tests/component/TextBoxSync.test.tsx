/**
 * Story 9 component tests (TC-12, TC-13): the box is written only after
 * local changes; remote changes are not re-measured.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { applyTextDiff } from '../../src/shared/text-edit';
import {
  createText,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

afterEach(() => {
  cleanup();
});

/** Deterministic fake: each character is half the font size wide. */
const measure: Measurer = (text, fontPx) => text.length * (fontPx / 2);

interface HarnessProps {
  doc: Y.Doc;
  id: string;
  onReady(api: { remeasure(): void }): void;
}

/** Minimal consumer of useTextBoxSync (TextObject uses it the same way). */
function Harness({ doc, id, onReady }: HarnessProps) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measure);
  const readyRef = useRef(false);
  useEffect(() => {
    if (!readyRef.current) {
      readyRef.current = true;
      act(() => onReady({ remeasure: remeasureAfterLocalChange }));
    }
  }, [onReady, remeasureAfterLocalChange]);
  return null;
}

function itemOf(doc: Y.Doc, id: string): Y.Map<any> {
  return doc.getMap('objects').get(id) as Y.Map<any>;
}

/** Counts width/height writes on the object (one event per setTextBox). */
function countBoxWrites(doc: Y.Doc, id: string): { count(): number } {
  const item = itemOf(doc, id);
  let writes = 0;
  item.observe((ev) => {
    if (ev.keys.has('width') || ev.keys.has('height')) writes++;
  });
  return { count: () => writes };
}

describe('text.object box sync', () => {
  it('TC-12: local text change → exactly one box write; remote change → none', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const writes = countBoxWrites(doc, id);
    const ready = { current: null as null | { remeasure(): void } };

    render(
      <Harness
        doc={doc}
        id={id}
        onReady={(api) => {
          ready.current = api;
        }}
      />,
    );
    expect(ready.current).not.toBeNull();
    const remeasure = () => act(() => ready.current!.remeasure());

    // Initial measure of the empty content matches the stored {0,0}: no write.
    remeasure();
    expect(writes.count()).toBe(0);

    // Remote text change: the box is NOT re-measured.
    doc.transact(() => {
      (itemOf(doc, id).get('text') as Y.Text).insert(0, 'remote words');
    }, 'remote');
    expect(writes.count()).toBe(0);
    expect(itemOf(doc, id).get('width')).toBe(0);

    // Local text change: exactly one box write.
    applyTextDiff(itemOf(doc, id).get('text') as Y.Text, 'hello world hello world', LOCAL_ORIGIN);
    remeasure();
    expect(writes.count()).toBe(1);
    expect(itemOf(doc, id).get('width')).toBe(230); // 23 chars × 10
    expect(itemOf(doc, id).get('height')).toBe(26); // one line at M

    // Measuring again with nothing local changed: no further write.
    remeasure();
    expect(writes.count()).toBe(1);
  });

  it('TC-13: local size change with an unchanged box → no write', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!; // empty content, box {0,0}
    const writes = countBoxWrites(doc, id);
    const ready = { current: null as null | { remeasure(): void } };
    render(
      <Harness
        doc={doc}
        id={id}
        onReady={(api) => {
          ready.current = api;
        }}
      />,
    );

    act(() => setTextSize(doc, id, 'L')); // local size change
    expect(writes.count()).toBe(0); // only the 'size' key changed
    act(() => ready.current!.remeasure()); // empty content → still {0,0}
    expect(writes.count()).toBe(0);
    expect(itemOf(doc, id).get('size')).toBe('L');
  });

  it('auto → fixed after a width drag: rewraps and writes the new height exactly once', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    doc.transact(
      () => (itemOf(doc, id).get('text') as Y.Text).insert(0, 'hello world hello world'),
      'remote',
    );
    const writes = countBoxWrites(doc, id);
    const ready = { current: null as null | { remeasure(): void } };
    render(
      <Harness
        doc={doc}
        id={id}
        onReady={(api) => {
          ready.current = api;
        }}
      />,
    );

    // Auto layout first: 23 chars × 10 = 230 wide, one line.
    act(() => ready.current!.remeasure());
    expect(itemOf(doc, id).get('width')).toBe(230);
    expect(itemOf(doc, id).get('height')).toBe(26);
    expect(writes.count()).toBe(1);

    // Side-handle drag: fixed width 100 (10 chars per line) → 4 lines.
    act(() => setTextWidthFixed(doc, id, 100)); // writes 'width' itself
    const before = writes.count();
    act(() => ready.current!.remeasure());
    expect(writes.count()).toBe(before + 1); // exactly one new write
    expect(itemOf(doc, id).get('width')).toBe(100);
    expect(itemOf(doc, id).get('height')).toBe(4 * 26);
    expect(itemOf(doc, id).get('widthMode')).toBe('fixed');
  });
});
