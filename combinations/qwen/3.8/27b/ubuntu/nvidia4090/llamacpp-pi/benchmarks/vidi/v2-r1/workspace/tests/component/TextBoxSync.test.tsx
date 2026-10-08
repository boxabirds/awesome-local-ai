// Story 9 component tests: the local-only text box sync rule (TC-12, TC-13).
//
// useTextBoxSync must write width/height only after a LOCAL change, and only
// when the measured box differs from the stored one. Remote changes never
// produce a local box write, so five clients never race to write
// dimensions. A real Y.Doc and a deterministic fake measurer are used.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { createText, getTextContent, setTextWidthFixed } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config';

/**
 * Record the actual box writes (a setTextBox call that changes the stored
 * box; unchanged calls open no transaction and are not writes).
 */
const hoisted = vi.hoisted(() => ({
  writes: [] as Array<{ id: string; box: { width: number; height: number } }>,
}));

vi.mock('../../src/shared/objects/text', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/shared/objects/text')>();
  return {
    ...mod,
    setTextBox: vi.fn((doc: Y.Doc, id: string, box: { width: number; height: number }) => {
      const obj = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
      if (obj && (obj.get('width') !== box.width || obj.get('height') !== box.height)) {
        hoisted.writes.push({ id, box });
      }
      return mod.setTextBox(doc, id, box);
    }),
  };
});

/** 10 world units per character at size M, scaled with the font. */
const measure = (s: string, fontPx: number): number => s.length * (fontPx / 2);

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('text box sync (component)', () => {
  beforeEach(() => {
    hoisted.writes.length = 0;
  });

  it('TC-12: a remote text change writes nothing; a local change writes exactly the measured box once', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;

    renderHook(() => useTextBoxSync(doc, id, measure));

    // A remote peer types into the same text (non-LOCAL_ORIGIN).
    act(() => {
      doc.transact(() => {
        getTextContent(doc, id)!.insert(0, 'h');
      }, 'remote-peer');
    });
    expect(hoisted.writes).toHaveLength(0);

    // A local change: exactly one write, with the measured box.
    act(() => {
      doc.transact(() => {
        getTextContent(doc, id)!.insert(0, 'a');
      }, LOCAL_ORIGIN);
    });
    expect(hoisted.writes).toHaveLength(1);
    // 'ah' is 2 characters → 20 wide, one line at M.
    expect(hoisted.writes[0]!.box).toEqual({
      width: 20,
      height: LINE_M,
      lines: ['ah'],
    });
  });

  it('TC-13: a remeasure whose box equals the stored box writes nothing (negative)', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    const { result } = renderHook(() => useTextBoxSync(doc, id, measure));

    // A local change measures a new box and writes it once.
    act(() => {
      doc.transact(() => {
        getTextContent(doc, id)!.insert(0, 'abc');
      }, LOCAL_ORIGIN);
    });
    expect(hoisted.writes).toHaveLength(1);
    expect(hoisted.writes[0]!.box).toEqual({
      width: 30,
      height: LINE_M,
      lines: ['abc'],
    });

    // The local-change hook firing again with the same measured box (e.g. a
    // size change that reproduces the stored box) must not write.
    act(() => {
      result.current.remeasureAfterLocalChange();
    });
    expect(hoisted.writes).toHaveLength(1);
  });

  it('an auto → fixed transition rewraps and writes the new box exactly once', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g')!;
    renderHook(() => useTextBoxSync(doc, id, measure));

    // Local typing: the auto box (170 wide, one line).
    act(() => {
      doc.transact(() => {
        getTextContent(doc, id)!.insert(0, 'hello world hello');
      }, LOCAL_ORIGIN);
    });
    expect(hoisted.writes).toHaveLength(1);
    expect(hoisted.writes[0]!.box).toEqual({
      width: 170,
      height: LINE_M,
      lines: ['hello world hello'],
    });

    // The handle drag sets a fixed width below the word width: every word
    // wraps to its own line and the height grows — one write for the change.
    act(() => {
      setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
    });
    expect(hoisted.writes).toHaveLength(2);
    expect(hoisted.writes[1]!.box).toEqual({
      width: TEXT_MIN_WIDTH_WORLD,
      height: 3 * LINE_M,
      lines: ['hello', 'world', 'hello'],
    });
  });
});
