import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, initDoc, objectSnapshot } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { worldToScreen } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { noteEl, pointer, renderApp, setCamera } from './helpers';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const selection = () => window.__vidi6!.selection!();
const strokeOf = (doc: Y.Doc, id: string) => objectSnapshot(doc).find((o) => o.id === id) as StrokeSnap;
const hitPath = (id: string) => document.querySelector(`[data-stroke-id="${id}"] [data-testid="stroke-hit"]`) as Element;
const line = (id: string) => document.querySelector(`[data-stroke-id="${id}"] [data-testid="stroke-line"]`) as Element;

function click(el: Element, x: number, y: number) {
  pointer(el, 'down', x, y);
  pointer(el, 'up', x, y);
}

describe('stroke object rendering and selection (stroke.object)', () => {
  it('renders a smoothed round-capped path in its colour and thickness, announced as Drawing', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }], color: 'purple', thickness: 'thick' }, 'g')!;
    renderApp(doc);
    expect(screen.getByRole('group', { name: 'Drawing' })).toHaveAttribute('data-stroke-id', id);
    const path = line(id);
    expect(path.getAttribute('d')).toBe('M 0 0 Q 50 40 75 20 L 100 0');
    expect(path).toHaveAttribute('stroke', PEN_COLORS.purple);
    expect(path).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD.thick));
    expect(path).toHaveAttribute('stroke-linecap', 'round');
    expect(path).toHaveAttribute('stroke-linejoin', 'round');
  });

  for (const zoom of [0.5, 2]) {
    it(`TC-15 at ${zoom * 100}% the registry hit test and a press 5 px from the line hit; 7 px misses`, () => {
      const doc = freshDoc();
      const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g')!;
      renderApp(doc);
      const cam = { x: -100, y: -100, zoom };
      setCamera(cam);
      const s = strokeOf(doc, id);
      const spec = getObjectType('stroke')!;
      expect(spec).toMatchObject({ resizable: true, aspectLocked: true, editableText: false });
      expect(spec.hitTest(s, { x: 100, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(s, { x: 100, y: -7 / zoom }, zoom)).toBe(false);
      const mid = worldToScreen(cam, { x: 100, y: 0 });
      click(hitPath(id), mid.x, mid.y + 7);
      expect(selection()).toEqual([]);
      click(hitPath(id), mid.x, mid.y - 5);
      expect(selection()).toEqual([id]);
      // The hit line reaches the tolerance on both sides, whatever the zoom.
      expect(Number(hitPath(id).getAttribute('stroke-width')) * zoom).toBeCloseTo(12, 6);
    });
  }

  it('a thick stroke is hit anywhere within half its thickness', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thick' }, 'g')!;
    const s = strokeOf(doc, id);
    // At 10% the screen tolerance is 60 units; at 400% it is 1.5, below half of 8.
    expect(getObjectType('stroke')!.hitTest(s, { x: 100, y: 3.9 }, 4)).toBe(true);
    expect(getObjectType('stroke')!.hitTest(s, { x: 100, y: 4.1 }, 4)).toBe(false);
  });

  it('TC-16 a click inside a stroke\'s box far from its line selects the sticky note below, not the stroke', () => {
    const doc = freshDoc();
    const note = createSticky(doc, { x: 200, y: 200 });
    // A U-shaped stroke above the note whose box covers it.
    const id = createStroke(doc, {
      points: [{ x: 50, y: 50 }, { x: 50, y: 350 }, { x: 350, y: 350 }, { x: 350, y: 50 }],
      color: 'black',
      thickness: 'medium',
    }, 'g')!;
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    const s = strokeOf(doc, id);
    expect(s.z).toBeGreaterThan(objectSnapshot(doc).find((o) => o.id === note)!.z);
    expect(getObjectType('stroke')!.hitTest(s, { x: 200, y: 200 }, 1)).toBe(false);
    // Even if a press inside the box reaches the stroke, it does not take it...
    click(hitPath(id), 200, 200);
    expect(selection()).not.toContain(id);
    // ...and the note below (which the browser hits there) is selected.
    click(noteEl(note), 200, 200);
    expect(selection()).toEqual([note]);
  });

  it('TC-21 a stroke deleted by someone else while selected leaves the selection without error', () => {
    const doc = freshDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g')!;
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    click(hitPath(id), 100, 2);
    expect(selection()).toEqual([id]);
    // A remote change: another client's update applied to this doc.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getMap('objects').delete(id);
    expect(() => act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), 'remote'))).not.toThrow();
    expect(selection()).toEqual([]);
    expect(screen.queryByRole('group', { name: 'Drawing' })).toBeNull();
  });
});
