import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { getObjectType, strokeHitTest } from '../../src/client/objects/registry';
import { type ObjectSnapshot, createSticky, deleteObjects, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { type StrokeSnap, createStroke, isStroke } from '../../src/shared/objects/stroke';
import { flushFrame, pointer } from './helpers';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function setup(doc: Y.Doc, camera = { x: 0, y: 0, zoom: 1 }) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  render(<App doc={doc} />);
  act(() => window.__vidi6?.setCamera(camera));
  flushFrame();
}

const selection = () => window.__vidi6?.getSelection?.();
const strokeEl = (id: string) => document.querySelector(`[data-stroke-object][data-id="${id}"]`) as HTMLElement;
const hitPath = (id: string) => strokeEl(id).querySelector('[data-testid="stroke-hit"]') as HTMLElement;
const strokeSnap = (doc: Y.Doc, id: string) => objectsSnapshot(doc).find((o) => o.id === id) as StrokeSnap;

/** The topmost object whose registry hit test accepts `world` (what a click there selects). */
function topmostAt(snapshot: readonly ObjectSnapshot[], world: Point, zoom: number): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const o = snapshot[i]!;
    if (getObjectType(o.type)?.hitTest(o, world, zoom)) return o;
  }
  return null;
}

describe('stroke.object', () => {
  it('renders a round-capped smooth path in its colour and thickness, named "Drawing"', () => {
    const doc = newDoc();
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }], color: 'purple', thickness: 'thick' },
      'g',
    )!;
    setup(doc);
    expect(screen.getByRole('img', { name: 'Drawing' })).toBe(strokeEl(id));
    const line = strokeEl(id).querySelector('.stroke-line')!;
    expect(line.getAttribute('d')).toMatch(/^M .* Q .* L /);
    expect(line.getAttribute('stroke')).toBe('#8E24AA');
    expect(line.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    expect(line.getAttribute('stroke-linejoin')).toBe('round');
  });

  it.each([0.5, 2])('TC-15 at zoom %s a click 5 px (screen) from the line selects it; 7 px does not', (zoom) => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 100 }, { x: 400, y: 100 }], color: 'black', thickness: 'thin' }, 'g')!;
    setup(doc, { x: -100, y: -100, zoom });
    // Screen point of world (200, 100), then 7 px and 5 px below the line.
    const mid = { x: (200 + 100) * zoom, y: (100 + 100) * zoom };
    const world = (p: Point) => ({ x: p.x / zoom - 100, y: p.y / zoom - 100 });
    const far = { x: mid.x, y: mid.y + 7 };
    const near = { x: mid.x, y: mid.y + 5 };
    const s = strokeSnap(doc, id);
    expect(getObjectType('stroke')!.hitTest(s, world(near), zoom)).toBe(true);
    expect(getObjectType('stroke')!.hitTest(s, world(far), zoom)).toBe(false);

    pointer(hitPath(id), 'down', far.x, far.y);
    pointer(hitPath(id), 'up', far.x, far.y);
    expect(selection()).toEqual([]);
    pointer(hitPath(id), 'down', near.x, near.y);
    pointer(hitPath(id), 'up', near.x, near.y);
    expect(selection()).toEqual([id]);
    expect(strokeEl(id).dataset.selected).toBe('true');
    expect(screen.getByRole('toolbar', { name: 'Drawing' })).toBeTruthy();
  });

  it('a thick stroke is also hit within half its thickness when that is larger than the pixel tolerance', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'thick' }, 'g')!;
    const s = strokeSnap(doc, id);
    // At 400%, 6 px = 1.5 units < half the thickness (4 units).
    expect(strokeHitTest(s, { x: 50, y: 3.9 }, 4)).toBe(true);
    expect(strokeHitTest(s, { x: 50, y: 4.1 }, 4)).toBe(false);
  });

  it('TC-16 a click inside a stroke’s box far from its line, over a sticky note, selects the note, not the stroke', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 300, y: 300 }) as string;
    // A loop around the note, drawn after it (on top); its box covers the note.
    const loop: Point[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      loop.push({ x: 300 + Math.cos(t) * 180, y: 300 + Math.sin(t) * 180 });
    }
    const id = createStroke(doc, { points: loop, color: 'red', thickness: 'medium' }, 'g')!;
    setup(doc);
    const s = strokeSnap(doc, id);
    expect(s.z).toBeGreaterThan(objectsSnapshot(doc).find((o) => o.id === note)!.z);
    // The note's centre is inside the stroke's box but far from its line.
    expect(s.x < 300 && s.x + s.width > 300 && s.y < 300 && s.y + s.height > 300).toBe(true);
    expect(strokeHitTest(s, { x: 300, y: 300 }, 1)).toBe(false);
    expect(topmostAt(objectsSnapshot(doc), { x: 300, y: 300 }, 1)?.id).toBe(note);
    // The stroke's element only takes presses on its line: its box lets them through.
    expect(getComputedStyle(strokeEl(id)).pointerEvents).toBe('none');
    expect(hitPath(id).getAttribute('pointer-events')).toBe('stroke');
    // A press reaching the line's hit area that far from the line is ignored…
    pointer(hitPath(id), 'down', 300, 300);
    pointer(hitPath(id), 'up', 300, 300);
    expect(selection()).toEqual([]);
    // …and the press lands on the note underneath (as in a browser).
    const noteEl = document.querySelector(`[data-sticky-note][data-id="${note}"]`) as HTMLElement;
    pointer(noteEl, 'down', 300, 300);
    pointer(noteEl, 'up', 300, 300);
    expect(selection()).toEqual([note]);
  });

  it('TC-21 a selected stroke deleted by someone else → selection cleared, no error', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 100 }, { x: 300, y: 100 }], color: 'black', thickness: 'medium' }, 'g')!;
    setup(doc);
    pointer(hitPath(id), 'down', 200, 100);
    pointer(hitPath(id), 'up', 200, 100);
    expect(selection()).toEqual([id]);
    // A remote delete arrives through another replica.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.on('update', (u: Uint8Array) => Y.applyUpdate(doc, u, 'remote'));
    expect(() => act(() => void deleteObjects(remote, [id]))).not.toThrow();
    flushFrame();
    expect(objectsSnapshot(doc).filter(isStroke)).toHaveLength(0);
    expect(strokeEl(id)).toBeNull();
    expect(selection()).toEqual([]);
    expect(screen.queryByRole('toolbar', { name: 'Drawing' })).toBeNull();
  });

  it('Delete removes a selected stroke; the resize keeps its proportions', () => {
    const doc = newDoc();
    const id = createStroke(doc, { points: [{ x: 100, y: 100 }, { x: 300, y: 200 }], color: 'black', thickness: 'medium' }, 'g')!;
    setup(doc);
    expect(getObjectType('stroke')).toMatchObject({ resizable: true, aspectLocked: true, editableText: false });
    pointer(hitPath(id), 'down', 200, 150);
    pointer(hitPath(id), 'up', 200, 150);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(objectsSnapshot(doc).filter(isStroke)).toHaveLength(0);
  });
});
