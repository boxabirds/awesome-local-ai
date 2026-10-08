/**
 * Story 9, box-sync component tests (design TC-12, TC-13).
 *
 * useTextBoxSync keeps a text object's stored width/height in sync with the
 * measured layout after LOCAL changes and never after remote ones. The
 * fake measurer is the same deterministic one as the layout unit tests
 * (10 world units per character at M).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { LOCAL_ORIGIN, moveObjects } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

const fake: Measurer = (text, fontPx) => text.length * (fontPx / 2);

/** Renders only the hook under test, with a button to force a re-measure. */
function Probe({ doc, id }: { doc: Y.Doc; id: string }) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, fake);
  return <button type="button" data-testid="remeasure" onClick={remeasureAfterLocalChange} />;
}

interface WriteSpy {
  writes: { width: number; height: number }[];
  dispose(): void;
}

/** Counts setTextBox-shaped writes (local width/height changes) on the entry. */
function watchBoxWrites(doc: Y.Doc, id: string): WriteSpy {
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
  const writes: { width: number; height: number }[] = [];
  const handler = (event: Y.YMapEvent<unknown>, tr: Y.Transaction): void => {
    if (tr.origin !== LOCAL_ORIGIN) {
      return;
    }
    if (event.keysChanged !== null && [ ...event.keysChanged ].some((k) => k === 'width' || k === 'height')) {
      writes.push({
        width: entry.get('width') as number,
        height: entry.get('height') as number,
      });
    }
  };
  entry.observe(handler);
  return {
    writes,
    dispose: () => entry.unobserve(handler),
  };
}

describe('text box sync (design text.wrap / text.fixed_width)', () => {
  it('TC-12: a local change produces exactly one setTextBox; a remote change produces none; an auto→fixed transition rewrites the height once', () => {
    const doc = new Y.Doc();
    let id = '';
    act(() => {
      id = createText(doc, { x: 0, y: 0 }, 'g_test')!;
    });
    render(<Probe doc={doc} id={id} />);

    const spy = watchBoxWrites(doc, id);
    try {
      const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
      expect(entry.get('width')).toBe(40); // createText's initial box
      expect(entry.get('height')).toBe(26);

      // Remote change (a peer's typing arrives as a non-LOCAL update):
      // the hook must not re-measure or write — the peer's box update is
      // authoritative.
      act(() => {
        doc.transact(
          () => getTextContent(doc, id)!.insert(0, 'remote words'),
          'remote-peer',
        );
      });
      expect(spy.writes).toHaveLength(0);
      expect(entry.get('width')).toBe(40);

      // Local change: one typing commit → exactly one setTextBox.
      act(() => {
        doc.transact(() => getTextContent(doc, id)!.insert(0, 'local '), LOCAL_ORIGIN);
      });
      // 'local remote words' = 18 chars → 180 wide at M, one line (26).
      expect(spy.writes).toEqual([{ width: 180, height: 26 }]);
      expect(entry.get('width')).toBe(180);
      expect(entry.get('height')).toBe(26);

      // The editor's explicit re-measure finds the box already in sync:
      // no redundant write.
      act(() => {
        fireEvent.click(screen.getByTestId('remeasure'));
      });
      expect(spy.writes).toEqual([{ width: 180, height: 26 }]);

      // Auto → fixed transition: the width drag writes width 40 (the
      // minimum) and the mode; the box sync then rewraps and writes the
      // new height. (The drag's width write and the re-wrap's height write
      // merge into one Yjs transaction batch, so the height value moves
      // exactly once: 26 → 78.)
      act(() => {
        expect(setTextWidthFixed(doc, id, 30)).toBe(true);
      });
      expect(entry.get('width')).toBe(40);
      expect(entry.get('widthMode')).toBe('fixed');
      // 'local remote words' at 40 wide: each word alone is wider than 40
      // (5/6/5 chars → 50/60/50), so three lines × 26.
      expect(entry.get('height')).toBe(78);
      // The height took exactly two values across the whole test (26 → 78):
      // the re-wrap wrote the new height exactly once, no redundant writes.
      expect(new Set(spy.writes.map((w) => w.height)).size).toBe(2);
      expect(spy.writes.at(-1)).toEqual({ width: 40, height: 78 });
    } finally {
      spy.dispose();
    }
  });

  it('TC-13: a local size change rewrites the box; when the re-measured box equals the stored one, no write happens (no redundant updates)', () => {
    const doc = new Y.Doc();
    let id = '';
    act(() => {
      id = createText(doc, { x: 10, y: 10 }, 'g_test')!;
    });
    render(<Probe doc={doc} id={id} />);

    const spy = watchBoxWrites(doc, id);
    try {
      const entry = doc.getMap('objects').get(id) as Y.Map<unknown>;

      // Type 'abc abc' at M: 7 chars → width 70, height 26.
      act(() => {
        doc.transact(() => getTextContent(doc, id)!.insert(0, 'abc abc'), LOCAL_ORIGIN);
      });
      expect(spy.writes).toEqual([{ width: 70, height: 26 }]);

      // Local size change M → L: the layout depends on the size, so the box
      // is rewritten ('abc abc' at L: 7 × 16 = 112 wide, one line 32 × 1.3).
      act(() => {
        expect(setTextSize(doc, id, 'L')).toBe(true);
      });
      expect(spy.writes).toEqual([{ width: 70, height: 26 }, { width: 112, height: 41.6 }]);
      expect(entry.get('size')).toBe('L');

      // Re-measuring with nothing changed (as the editor does after every
      // input) must not write again.
      act(() => {
        fireEvent.click(screen.getByTestId('remeasure'));
      });
      expect(spy.writes).toEqual([{ width: 70, height: 26 }, { width: 112, height: 41.6 }]);

      // A local position move is not a layout input: no re-measure, no write.
      act(() => {
        expect(moveObjects(doc, new Map([[id, { x: 99, y: 99 }]]))).toBe(1);
      });
      expect(spy.writes).toEqual([{ width: 70, height: 26 }, { width: 112, height: 41.6 }]);
      expect(entry.get('x')).toBe(99);
    } finally {
      spy.dispose();
    }
  });
});
