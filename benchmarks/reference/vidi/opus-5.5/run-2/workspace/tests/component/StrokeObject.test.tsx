/** Story 11 stroke.object component tests (TC-15, TC-16, TC-21): registry hit test, select by the line, remote delete. */
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObjects, snapshotObjects } from '../../src/shared/board-model';
import { createStroke, isStrokeSnap, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { STROKE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { readCamera } from './helpers';
import { objectEl, pointer, renderApp, setCamera, toScreen } from './shapeHelpers';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

afterEach(() => {
  vi.useRealTimers();
});

function stroke(id: string): StrokeSnap {
  return snapshotObjects(doc).filter(isStrokeSnap).find((s) => s.id === id)!;
}

function hitPath(id: string): Element {
  return objectEl(id).querySelector('[data-testid="stroke-hit"]')!;
}

function addLine(): string {
  let id = '';
  act(() => {
    id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g')!;
  });
  return id;
}

describe('stroke.object', () => {
  it('registry entry: resizable, aspect-locked, STROKE_MIN_SIZE_WORLD, no text', () => {
    expect(getObjectType('stroke')).toMatchObject({
      resizable: true,
      aspectLocked: true,
      minSize: STROKE_MIN_SIZE_WORLD,
      editableText: false,
    });
  });

  for (const zoom of [0.5, 2]) {
    it(`TC-15 at ${zoom * 100}%: 5 screen px from the line hits, 7 px misses (registry and pointer)`, () => {
      renderApp(doc);
      const id = addLine();
      const s = stroke(id);
      const spec = getObjectType('stroke')!;
      expect(spec.hitTest(s, { x: 100, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(s, { x: 100, y: -5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(s, { x: 100, y: 7 / zoom }, zoom)).toBe(false);
      // Past the end: distance to the end point.
      expect(spec.hitTest(s, { x: 200 + 7 / zoom, y: 0 }, zoom)).toBe(false);

      setCamera({ x: -100, y: -100, zoom });
      const camera = readCamera();
      expect(camera.zoom).toBe(zoom);
      const onLine = toScreen({ x: 100, y: 0 }, camera);
      pointer(hitPath(id), 'pointerDown', { x: onLine.x, y: onLine.y + 7 });
      pointer(hitPath(id), 'pointerUp', { x: onLine.x, y: onLine.y + 7 });
      expect(objectEl(id)).toHaveAttribute('data-selected', 'false');
      pointer(hitPath(id), 'pointerDown', { x: onLine.x, y: onLine.y - 5 });
      pointer(hitPath(id), 'pointerUp', { x: onLine.x, y: onLine.y - 5 });
      expect(objectEl(id)).toHaveAttribute('data-selected', 'true');
      // The pointer band is the tolerance on screen at every zoom.
      expect(Number(hitPath(id).getAttribute('stroke-width')) * zoom).toBeCloseTo(12);
    });
  }

  it('TC-15 a thick stroke is also hit anywhere within half its thickness', () => {
    let id = '';
    act(() => {
      id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'red', thickness: 'thick' }, 'g')!;
    });
    const spec = getObjectType('stroke')!;
    // At 400% the screen tolerance is 1.5 world units, less than half the thickness (4).
    expect(spec.hitTest(stroke(id), { x: 50, y: 3.9 }, 4)).toBe(true);
    expect(spec.hitTest(stroke(id), { x: 50, y: 4.1 }, 4)).toBe(false);
  });

  it('TC-16 a press inside the stroke bounds far from its line selects the sticky underneath, not the stroke', () => {
    renderApp(doc);
    let noteId = '';
    let strokeId = '';
    act(() => {
      noteId = createSticky(doc, { x: 100, y: 100 });
      // A loose loop around the note: its bounds contain the note, its line never crosses it.
      strokeId = createStroke(
        doc,
        { points: [{ x: 50, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 400 }, { x: 50, y: 400 }, { x: 50, y: 60 }], color: 'black', thickness: 'medium' },
        'g',
      )!;
    });
    const s = stroke(strokeId);
    expect(s.z).toBeGreaterThan(snapshotObjects(doc).find((o) => o.id === noteId)!.z);
    const inside = { x: 200, y: 200 };
    expect(getObjectType('stroke')!.hitTest(s, inside, readCamera().zoom)).toBe(false);

    const at = toScreen(inside);
    // Were the press to land on the stroke's band, it would not take it...
    pointer(hitPath(strokeId), 'pointerDown', at);
    pointer(hitPath(strokeId), 'pointerUp', at);
    expect(objectEl(strokeId)).toHaveAttribute('data-selected', 'false');
    // ...and it reaches the note underneath (only the band takes pointer input).
    pointer(objectEl(noteId), 'pointerDown', at);
    pointer(objectEl(noteId), 'pointerUp', at);
    expect(objectEl(noteId)).toHaveAttribute('data-selected', 'true');
    expect(objectEl(strokeId)).toHaveAttribute('data-selected', 'false');
    expect(screen.getAllByTestId('selection-outline').map((o) => o.dataset.objectId)).toEqual([noteId]);
  });

  it('TC-21 a selected stroke deleted by someone else: selection cleared, no error', () => {
    renderApp(doc);
    const id = addLine();
    const onLine = toScreen({ x: 100, y: 0 });
    pointer(hitPath(id), 'pointerDown', onLine);
    pointer(hitPath(id), 'pointerUp', onLine);
    expect(objectEl(id)).toHaveAttribute('data-selected', 'true');
    expect(screen.getAllByTestId('selection-outline')).toHaveLength(1);

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.on('update', (u: Uint8Array) => Y.applyUpdate(doc, u, 'remote'));
    expect(() =>
      act(() => {
        deleteObjects(remote, [id]);
      }),
    ).not.toThrow();
    expect(document.querySelector(`[data-id="${id}"]`)).toBeNull();
    expect(screen.queryAllByTestId('selection-outline')).toHaveLength(0);
  });

  it('renders a smooth round-capped path in the stroke colour, labelled "Drawing"', () => {
    renderApp(doc);
    const id = addLine();
    const line = objectEl(id).querySelector('[data-testid="stroke-line"]')!;
    expect(objectEl(id)).toHaveAccessibleName('Drawing');
    expect(line.getAttribute('aria-label')).toBe('Drawing');
    expect(line.getAttribute('d')).toMatch(/^M .* Q /);
    expect(line.getAttribute('stroke')).toBe('#212121');
    expect(line.getAttribute('stroke-width')).toBe('2');
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    expect(line.getAttribute('stroke-linejoin')).toBe('round');
  });
});
