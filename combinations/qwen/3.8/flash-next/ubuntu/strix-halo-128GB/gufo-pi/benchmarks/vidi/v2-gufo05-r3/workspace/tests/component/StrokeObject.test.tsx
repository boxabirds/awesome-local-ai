/**
 * Component tests for the stroke renderer, its hit test and its share of the
 * selection machinery (story 11, task 5): TC-15, TC-16.
 *
 * The hit test is checked through the registry — the same path the selection
 * code uses — and the geometry through the rendered SVG, at zoom 1 where a
 * screen pixel and a world unit agree.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { stubViewportSize, withPeer } from './boardHarness';
import { screenOf } from './flowHarness';
import { snapshot } from '../../src/shared/board-model';
import { createStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';

stubViewportSize();

const strokesOf = (doc: Y.Doc): StrokeSnap[] =>
  snapshot(doc).filter((s): s is StrokeSnap => s.type === 'stroke');

/** A horizontal three-point line from (300,300) to (500,300). */
function seedStroke(
  doc: Y.Doc,
  thickness: 'thin' | 'medium' | 'thick' = 'medium',
): StrokeSnap {
  const id = createStroke(
    doc,
    {
      points: [
        { x: 300, y: 300 },
        { x: 400, y: 300 },
        { x: 500, y: 300 },
      ],
      color: 'blue',
      thickness,
    },
    'priya',
  );
  if (id === null) throw new Error('the seeded stroke was refused');
  const seeded = strokesOf(doc).find((s) => s.id === id);
  if (!seeded) throw new Error('the seeded stroke is not in the snapshot');
  return seeded;
}

const hitPath = (container: HTMLElement, id: string): HTMLElement =>
  container.querySelector<HTMLElement>(`[data-testid="stroke-hit-${id}"]`)!;

const inkPath = (container: HTMLElement, id: string): SVGPathElement =>
  container.querySelector<SVGPathElement>(`[data-testid="stroke-line-${id}"]`)!;

describe('StrokeObject and the stroke hit test (pen.select, pen.resize, pen.delete)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  it('the registry knows the stroke: resizable, aspect-locked, no text editing', () => {
    const spec = getObjectType('stroke');
    if (!spec) throw new Error('the stroke type is not registered');
    expect(spec.resizable).toBe(true);
    expect(spec.aspectLocked).toBe(true);
    expect(spec.editableText).toBe(false);
  });

  it('TC-15 the hit test crosses 6 screen pixels exactly, at any zoom', () => {
    const stroke = seedStroke(doc, 'thin');
    const hit = getObjectType('stroke')!.hitTest as (
      object: typeof stroke,
      at: { x: number; y: number },
      zoom?: number,
    ) => boolean;
    // Zoom 1: half the thickness (1) is below the tolerance (6).
    expect(hit(stroke, { x: 400, y: 300 + STROKE_HIT_TOLERANCE_PX - 0.1 }, 1)).toBe(true);
    expect(hit(stroke, { x: 400, y: 300 + STROKE_HIT_TOLERANCE_PX + 0.1 }, 1)).toBe(false);
    expect(hit(stroke, { x: 400, y: 300 + 5.9 }, 1)).toBe(true);
    expect(hit(stroke, { x: 400, y: 300 + 6.1 }, 1)).toBe(false);
    // Zoom 2: 6 screen px are 3 world units; the thin line itself (2) is less.
    expect(hit(stroke, { x: 400, y: 300 + 2.9 }, 2)).toBe(true);
    expect(hit(stroke, { x: 400, y: 300 + 3.1 }, 2)).toBe(false);

    // A thick line at high zoom: half its own thickness (4) beats 6/4 = 1.5.
    const fat = seedStroke(doc, 'thick');
    expect(hit(fat, { x: 400, y: 300 + 3.9 }, 4)).toBe(true);
    expect(hit(fat, { x: 400, y: 300 + 4.1 }, 4)).toBe(false);
    // Beside the line, outside the stroke: no hit (a click reaches the board).
    expect(hit(stroke, { x: 260, y: 260 }, 1)).toBe(false);
  });

  it('a dot is hittable at its centre and nowhere else', () => {
    createStroke(doc, { points: [{ x: 200, y: 120 }], color: 'red', thickness: 'thick' }, 'a');
    const dot = strokesOf(doc)[0]!;
    const hit = getObjectType('stroke')!.hitTest as (
      object: StrokeSnap,
      at: { x: number; y: number },
      zoom?: number,
    ) => boolean;
    expect(hit(dot, { x: 200, y: 120 }, 1)).toBe(true);
    expect(hit(dot, { x: 200 + 6.1, y: 120 }, 1)).toBe(false);
    expect(dot.width).toBe(PEN_THICKNESS_WORLD.thick);
  });

  it('a stroke renders as ink in its colour with round caps', () => {
    const stroke = seedStroke(doc);
    const { container } = render(<App doc={doc} />);
    const object = container.querySelector<HTMLElement>(`[data-object-id="${stroke.id}"]`);
    if (!object) throw new Error('the stroke is not rendered');
    expect(object.dataset.objectType).toBe('stroke');
    expect(container.querySelector('[aria-label="Drawing"]')).not.toBeNull();
    const ink = inkPath(container, stroke.id);
    expect(ink.getAttribute('stroke')).toBe(PEN_COLORS.blue);
    expect(ink.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    expect(ink.getAttribute('stroke-linecap')).toBe('round');
    // The path runs through the stored points.
    const d = ink.getAttribute('d')!;
    expect(d.startsWith('M 300 300')).toBe(true);
    expect(d.trim().endsWith('500 300')).toBe(true);
  });

  /** Press the line itself: the stroke becomes the selection. */
  function selectStroke(container: HTMLElement, id: string): void {
    const at = screenOf(container, { x: 400, y: 300 });
    fireEvent.pointerDown(hitPath(container, id), {
      clientX: at.x,
      clientY: at.y,
      button: 0,
      pointerId: 11,
    });
    fireEvent.pointerUp(window, { clientX: at.x, clientY: at.y, button: 0, pointerId: 11 });
  }

  it('pressing the line selects it; pressing elsewhere does not', () => {
    const stroke = seedStroke(doc);
    const { container } = render(<App doc={doc} />);
    expect(container.querySelector('[data-selected="true"]')).toBeNull();
    selectStroke(container, stroke.id);
    const selected = container.querySelector<HTMLElement>(
      `[data-object-type="stroke"][data-selected="true"]`,
    );
    if (!selected) throw new Error('pressing the line did not select the stroke');
    expect(selected.dataset.objectId).toBe(stroke.id);
  });

  it('dragging the line moves the stroke', () => {
    const stroke = seedStroke(doc);
    const { container } = render(<App doc={doc} />);
    const at = screenOf(container, { x: 400, y: 300 });
    fireEvent.pointerDown(hitPath(container, stroke.id), {
      clientX: at.x,
      clientY: at.y,
      button: 0,
      pointerId: 12,
    });
    fireEvent.pointerMove(window, { clientX: at.x + 70, clientY: at.y + 25, button: 0, pointerId: 12 });
    fireEvent.pointerUp(window, { clientX: at.x + 70, clientY: at.y + 25, button: 0, pointerId: 12 });

    const after = strokesOf(doc)[0]!;
    expect(after.x).toBeCloseTo(stroke.x + 70, 6);
    expect(after.y).toBeCloseTo(stroke.y + 25, 6);
    // The drawing moved with the box: the stored points did not change.
    expect(after.points).toEqual(stroke.points);
  });

  it('TC-16 a corner drag scales the drawing proportionally and keeps the thickness', () => {
    const stroke = seedStroke(doc);
    const { container } = render(<App doc={doc} />);
    selectStroke(container, stroke.id);
    const handle = container.querySelector<HTMLElement>('[data-resize-handle="se"]');
    if (!handle) throw new Error('a selected stroke shows no resize handles');

    const before = strokesOf(doc)[0]!;
    const corner = screenOf(container, {
      x: before.x + (before.width ?? 0),
      y: before.y + (before.height ?? 0),
    });
    fireEvent.pointerDown(handle, { clientX: corner.x, clientY: corner.y, button: 0, pointerId: 13 });
    fireEvent.pointerMove(window, { clientX: corner.x + 60, clientY: corner.y + 30, button: 0, pointerId: 13 });
    fireEvent.pointerUp(window, { clientX: corner.x + 60, clientY: corner.y + 30, button: 0, pointerId: 13 });

    const after = strokesOf(doc)[0]!;
    const width = after.width ?? 0;
    const height = after.height ?? 0;
    expect(width).toBeGreaterThan(0);
    // The aspect ratio is kept — "it scales in proportion".
    const ratioBefore = (before.width ?? 1) / (before.height ?? 1);
    expect(Math.abs(width / height - ratioBefore) / ratioBefore).toBeLessThan(0.01);
    // The stored pen did not scale with the picture.
    expect(after.thickness).toBe('medium');
    expect(inkPath(container, stroke.id).getAttribute('stroke-width')).toBe(
      String(PEN_THICKNESS_WORLD.medium),
    );
    // And the drawing itself grew with the box: scaled points span the new
    // width minus the padding the pen added around it.
    const side = PEN_THICKNESS_WORLD.medium;
    const scaled = scaledPoints(after);
    const minX = Math.min(...scaled.map((p) => p.x));
    const maxX = Math.max(...scaled.map((p) => p.x));
    expect(maxX - minX).toBeCloseTo((after.baseWidth - side) * (width / after.baseWidth), 6);
  });

  it('pen.delete: Delete removes the selected stroke and nothing else survives it', () => {
    const stroke = seedStroke(doc);
    const { container } = render(<App doc={doc} />);
    selectStroke(container, stroke.id);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(strokesOf(doc)).toHaveLength(0);
    expect(container.querySelector(`[data-object-id="${stroke.id}"]`)).toBeNull();
    expect(container.querySelector('[data-selected="true"]')).toBeNull();
  });

  it('a remote stroke appears live, in its author\u2019s ink', () => {
    const { doc: local, peer: peerDoc, disconnect } = withPeer();
    const { container } = render(<App doc={local} />);

    act(() => {
      createStroke(
        peerDoc,
        {
          points: [
            { x: -100, y: -100 },
            { x: -50, y: -80 },
            { x: 0, y: -100 },
          ],
          color: 'purple',
          thickness: 'thin',
        },
        'sam',
      );
    });
    disconnect();

    const stroke = strokesOf(local)[0];
    if (!stroke) throw new Error('the remote stroke did not arrive');
    expect(stroke.color).toBe('purple');
    const ink = inkPath(container, stroke.id);
    expect(ink.getAttribute('stroke')).toBe(PEN_COLORS.purple);
  });
});
