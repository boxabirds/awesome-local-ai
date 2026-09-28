import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useMarquee } from '../../src/client/board/Marquee';
import { createSticky, initDoc, snapshot, objectsInRect } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';

afterEach(cleanup);

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// ─── TC-20: Shift+drag around objects adds fully-inside ids to selection ───
describe('TC-20 marquee selects fully-contained objects', () => {
  it('objectsInRect returns only fully-inside objects', () => {
    const doc = newDoc();
    const idA = createSticky(doc, { x: 100, y: 100 }); // bounds: (0, 0, 200, 200)
    const idB = createSticky(doc, { x: 250, y: 100 }); // bounds: (150, 0, 200, 200)
    const idC = createSticky(doc, { x: 500, y: 500 }); // bounds: (400, 400, 200, 200)

    const snaps = snapshot(doc);

    // Selection rect that fully contains A only: (-10, -10, 220, 220) → covers (0,0)-(210,210)
    // A: (0,0)-(200,200) → inside
    // B: (150,0)-(350,200) → right edge 350 > 210 → NOT inside
    // C: (400,400)-(600,600) → NOT inside
    const rect: Rect = { x: -10, y: -10, width: 220, height: 220 };
    const ids = objectsInRect(snaps, rect);
    expect(ids).toEqual([idA]);
    expect(ids).not.toContain(idB);
    expect(ids).not.toContain(idC);
  });

  it('useMarquee begin/move/end calls onSelect with inside ids', () => {
    const doc = newDoc();
    const idA = createSticky(doc, { x: 100, y: 100 });
    const snaps = snapshot(doc);
    const onSelect = vi.fn();
    const camera = { x: 0, y: 0, zoom: 1 };

    const { result } = renderHook(() => useMarquee(camera, snaps, onSelect));

    // Begin at screen (0, 0), move to screen (210, 210) → world rect (0,0,210,210)
    // idA bounds: (0, 0, 200, 200) → inside
    act(() => { result.current.begin({ x: 0, y: 0 }); });
    act(() => { result.current.move({ x: 220, y: 220 }); });
    act(() => { result.current.end(); });

    expect(onSelect).toHaveBeenCalledWith([idA]);
  });
});

// ─── TC-21: plain drag (no Shift) does NOT start marquee ───
describe('TC-21 marquee requires Shift key', () => {
  it('useMarquee only activates when explicitly begin() called (viewport handles shift check)', () => {
    const doc = newDoc();
    createSticky(doc, { x: 100, y: 100 });
    const snaps = snapshot(doc);
    const onSelect = vi.fn();
    const camera = { x: 0, y: 0, zoom: 1 };

    const { result } = renderHook(() => useMarquee(camera, snaps, onSelect));

    // Without calling begin, no selection should happen
    act(() => { result.current.end(); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(result.current.rect).toBeNull();
  });
});

// ─── TC-22: pointercancel mid-marquee → selection unchanged ───
describe('TC-22 cancel mid-marquee', () => {
  it('cancel() does not call onSelect', () => {
    const doc = newDoc();
    createSticky(doc, { x: 100, y: 100 });
    const snaps = snapshot(doc);
    const onSelect = vi.fn();
    const camera = { x: 0, y: 0, zoom: 1 };

    const { result } = renderHook(() => useMarquee(camera, snaps, onSelect));

    act(() => { result.current.begin({ x: 0, y: 0 }); });
    act(() => { result.current.move({ x: 300, y: 300 }); });
    // Cancel instead of end
    act(() => { result.current.cancel(); });

    expect(onSelect).not.toHaveBeenCalled();
    expect(result.current.rect).toBeNull();
  });
});
