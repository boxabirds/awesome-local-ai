/**
 * stroke.object (story 11): rendering, the registry's line-distance hit test, selection that
 * falls through to objects below, and a remote delete while selected. TC-15, TC-16, TC-21.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getObjectType } from '../../src/client/objects/registry';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { deleteObjects, initDoc, objectSnapshot } from '../../src/shared/board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, isStroke, scaledLocalPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { addStroke, strokeEls, strokes } from './penHelpers';
import { selectedIds, setZoom, toScreen } from './shapeHelpers';
import { board, click, createSelectedNote, notes, renderBoard } from './stickyHelpers';
import { pressKey, remote } from './textHelpers';

const HORIZONTAL = [
  { x: 0, y: 0 },
  { x: 300, y: 0 },
];

function standaloneStroke(thickness: 'thin' | 'medium' | 'thick' = 'thin'): StrokeSnap {
  const doc = new Y.Doc();
  initDoc(doc);
  createStroke(doc, { points: HORIZONTAL, color: 'blue', thickness }, 'g_test');
  return objectSnapshot(doc).filter(isStroke)[0]!;
}

describe('stroke.object rendering', () => {
  it('renders a smooth round-capped path in the stroke colour, thickness in world units, named "Drawing"', () => {
    const s = standaloneStroke('thick');
    render(<StrokeObject stroke={s} selected={false} />);
    const path = screen.getByTestId('stroke-path');
    expect(path.getAttribute('d')).toBe(smoothPath(scaledLocalPoints(s)));
    expect(path.getAttribute('stroke')).toBe(PEN_COLORS.blue);
    expect(path.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('aria-label')).toBe('Drawing');
  });

  it('a resized stroke draws its line scaled to the new box with the same thickness', () => {
    const s = standaloneStroke('medium');
    const doubled: StrokeSnap = { ...s, width: s.width * 2, height: s.height * 2 };
    render(<StrokeObject stroke={doubled} selected={false} />);
    const path = screen.getByTestId('stroke-path');
    expect(path.getAttribute('d')).toBe(smoothPath(scaledLocalPoints(doubled)));
    expect(path.getAttribute('d')).not.toBe(smoothPath(scaledLocalPoints(s)));
    expect(path.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
  });

  it('registry entry: resizable, aspect-locked, minimum STROKE_MIN_SIZE_WORLD, no text', () => {
    expect(getObjectType('stroke')).toMatchObject({
      resizable: true,
      aspectLocked: true,
      minSize: STROKE_MIN_SIZE_WORLD,
      editableText: false,
      hitByGeometry: true,
    });
  });
});

describe('stroke.object selection', () => {
  it.each([0.5, 2])('TC-15 at zoom %s: registry hitTest hits at 5 screen px from the line, misses at 7', (zoom) => {
    const s = standaloneStroke('thin');
    const spec = getObjectType('stroke')!;
    const near = (STROKE_HIT_TOLERANCE_PX - 1) / zoom;
    const far = (STROKE_HIT_TOLERANCE_PX + 1) / zoom;
    expect(spec.hitTest(s, { x: 150, y: near }, zoom)).toBe(true);
    expect(spec.hitTest(s, { x: 150, y: -far }, zoom)).toBe(false);
    expect(spec.hitTest(s, { x: 150, y: far }, zoom)).toBe(false);
  });

  it.each([0.5, 2])('TC-15 at zoom %s on the board: a click 5 px from the line selects the stroke, 7 px does not', (zoom) => {
    renderBoard();
    setZoom(zoom, { x: -100, y: -200 });
    const id = addStroke(HORIZONTAL, 'black', 'thin');
    const onLine = toScreen({ x: 150, y: 0 });
    const near = { x: onLine.x, y: onLine.y + (STROKE_HIT_TOLERANCE_PX - 1) };
    const far = { x: onLine.x, y: onLine.y + (STROKE_HIT_TOLERANCE_PX + 1) };
    click(board(), far.x, far.y);
    expect(selectedIds()).toEqual([]);
    click(board(), near.x, near.y);
    expect(selectedIds()).toEqual([id]);
    click(board(), far.x, far.y);
    expect(selectedIds()).toEqual([]);
  });

  it('a thick stroke is also hit within half its thickness when that is larger than the screen tolerance', () => {
    const s = standaloneStroke('thick');
    const zoom = 4;
    const spec = getObjectType('stroke')!;
    const half = PEN_THICKNESS_WORLD.thick / 2;
    expect(half).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX / zoom);
    expect(spec.hitTest(s, { x: 100, y: half - 0.1 }, zoom)).toBe(true);
    expect(spec.hitTest(s, { x: 100, y: half + 0.1 }, zoom)).toBe(false);
  });

  it('TC-16 a click inside a loop stroke’s box but far from its line, over a sticky note, selects the note, not the stroke', () => {
    renderBoard();
    const noteEl = createSelectedNote(400, 300);
    const note = notes()[0]!;
    click(board(), 1000, 700);
    expect(selectedIds()).toEqual([]);
    // A loop drawn around the note, above it (created later).
    const cx = note.x + 100;
    const cy = note.y + 100;
    const loop = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 39) * 2 * Math.PI;
      return { x: cx + Math.cos(a) * 180, y: cy + Math.sin(a) * 180 };
    });
    const strokeId = addStroke(loop, 'red', 'medium');
    expect(strokes()[0]!.z).toBeGreaterThan(note.z);
    const inside = toScreen({ x: cx, y: cy });
    click(noteEl, inside.x, inside.y);
    expect(selectedIds()).toEqual([note.id]);
    // On the line itself (over empty board): the stroke.
    const onLine = toScreen(loop[0]!);
    click(board(), onLine.x, onLine.y);
    expect(selectedIds()).toEqual([strokeId]);
  });

  it('TC-21 a selected stroke deleted by someone else clears the selection without an error', () => {
    renderBoard();
    const id = addStroke(HORIZONTAL, 'black', 'medium');
    const p = toScreen({ x: 150, y: 0 });
    click(board(), p.x, p.y);
    expect(selectedIds()).toEqual([id]);
    expect(screen.getByRole('button', { name: 'Resize bottom-right' })).toBeTruthy();
    remote((d) => deleteObjects(d, [id]));
    expect(strokeEls()).toHaveLength(0);
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Resize bottom-right' })).toBeNull();
  });

  it('Delete removes a selected stroke', () => {
    renderBoard();
    const id = addStroke(HORIZONTAL, 'black', 'medium');
    const p = toScreen({ x: 150, y: 0 });
    click(board(), p.x, p.y);
    expect(selectedIds()).toEqual([id]);
    pressKey('Delete');
    expect(strokes()).toHaveLength(0);
  });
});
