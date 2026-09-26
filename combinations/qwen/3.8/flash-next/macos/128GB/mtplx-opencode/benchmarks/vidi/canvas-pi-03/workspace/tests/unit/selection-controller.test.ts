import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { SelectionController, type PressInput } from '../../src/client/board/selection-controller';
import { initDoc, createSticky, objectsInRect, moveObjects } from '../../src/shared/board-model';
import { normalizeRect } from '../../src/shared/geometry';

function press(over: Partial<PressInput> & { point: { x: number; y: number } }): PressInput {
  return { shift: false, meta: false, ctrl: false, hitId: null, ...over };
}

describe('SelectionController', () => {
  it('plain press on a note selects only it (begin-drag)', () => {
    const sel = new SelectionController();
    sel.setSelection(['a', 'b']);
    const res = sel.press(press({ point: { x: 0, y: 0 }, hitId: 'c' }));
    expect(res.action).toBe('begin-drag');
    expect(sel.getSelection()).toEqual(['c']);
  });

  it('press a note already in the set drags the whole set', () => {
    const sel = new SelectionController();
    sel.setSelection(['a', 'b']);
    const res = sel.press(press({ point: { x: 0, y: 0 }, hitId: 'a' }));
    expect(res.action).toBe('start-drag');
    expect(sel.dragSet()).toEqual(['a', 'b']);
  });

  it('Shift toggle adds and removes from the set', () => {
    const sel = new SelectionController();
    sel.press(press({ point: { x: 0, y: 0 }, hitId: 'a' }));
    sel.press(press({ point: { x: 0, y: 0 }, hitId: 'b', shift: true }));
    expect(sel.getSelection().sort()).toEqual(['a', 'b']);
    // Toggle b off again.
    sel.press(press({ point: { x: 0, y: 0 }, hitId: 'b', shift: true }));
    expect(sel.getSelection()).toEqual(['a']);
  });

  it('plain press on empty board clears and pans', () => {
    const sel = new SelectionController();
    sel.setSelection(['a']);
    const res = sel.press(press({ point: { x: 0, y: 0 }, hitId: null }));
    expect(res.action).toBe('pan');
    expect(sel.getSelection()).toEqual([]);
  });

  it('Shift press on empty board arms a marquee', () => {
    const sel = new SelectionController();
    const res = sel.press(press({ point: { x: 0, y: 0 }, hitId: null, shift: true }));
    expect(res.action).toBe('marquee');
  });

  it('marquee: the hit ids become the selection (real doc + geometry)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const near = createSticky(doc, { x: 0, y: 0 });
    const far = createSticky(doc, { x: 4000, y: 4000 });
    const sel = new SelectionController();

    // Drag a marquee that fully encloses only the near note. The rect is
    // world-space, and a note "at" {x,y} spans +/-100 around that point, so a
    // rect starting at -20 would only clip the note and select nothing.
    const rect = normalizeRect({ x: -200, y: -200 }, { x: 200, y: 200 });
    const hits = objectsInRect(doc, rect);
    sel.press(press({ point: { x: -20, y: -20 }, hitId: null, shift: true }));
    const after = sel.applyMarquee(hits, false);

    expect(after).toContain(near);
    expect(after).not.toContain(far);
    expect(sel.dragSet()).toEqual([]);
  });

  it('group drag moves together (no collapse) through moveObjects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 500, y: 0 });
    const sel = new SelectionController();
    sel.press(press({ point: { x: 0, y: 0 }, hitId: a })); // select a
    sel.press(press({ point: { x: 500, y: 0 }, hitId: b, shift: true })); // + b
    const set = sel.getSelection();
    expect(set).toHaveLength(2);
    // Moving the group by 100 keeps them 500 apart.
    moveObjects(doc, set, 100, 0);
    const objs = doc.getMap<Y.Map<unknown>>('objects');
    const dx = (objs.get(b)!.get('x') as number) - (objs.get(a)!.get('x') as number);
    expect(dx).toBeCloseTo(500);
  });
});
