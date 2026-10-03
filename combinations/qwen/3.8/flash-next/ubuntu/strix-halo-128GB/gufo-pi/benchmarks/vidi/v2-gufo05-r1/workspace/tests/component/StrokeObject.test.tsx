// Story 11 · Sketch freehand with a pen — the stroke as a selectable, resizable object, and the
// Pen's options panel.
//
// The selection overlay, the resize gesture and the hit test all read the *registry*, not a
// rendered pixel. So these tests assert the contract a stroke registers — that it is resizable,
// aspect-locked, drawn with eight handles, resized proportionally, and picked by distance to its
// line rather than by its box. That is exactly what the app asks the stroke type when it draws a
// box around it or decides whether a click landed on it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

// Importing the registry registers every object type (stroke included) at module load.
import { getObjectType, handlesFor } from '../../src/client/objects/registry';
import { createStroke, scaledPoints, strokeHitTest, type StrokeSnap } from '../../src/shared/objects/stroke';
import { objectSnapshots, initDoc, deleteObject, createSticky } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { PenToolbar } from '../../src/client/tools/PenToolbar';

function onlyStroke(doc: Y.Doc): StrokeSnap {
  const made = objectSnapshots(doc).filter((s): s is StrokeSnap => s.type === 'stroke');
  expect(made).toHaveLength(1);
  return made[0]!;
}

describe('stroke registry entry (story 11)', () => {
  it('is resizable, aspect-locked, editable-text-free, with eight handles and a small minimum', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.editableText).toBe(false);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    // Eight handles is the default set — the resize box a person drags by.
    expect(spec!.handles).toHaveLength(8);
  });

  it('a selected stroke offers eight handles (the box a person resizes)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createStroke(doc, { points: [{ x: 20, y: 20 }, { x: 120, y: 80 }], color: 'black', thickness: 'medium' }, 'me');
    const stroke = onlyStroke(doc);
    expect(handlesFor([stroke])).toHaveLength(8);
  });
});

describe('stroke hit test (story 11 · TC-15)', () => {
  // A diagonal from (10,10) to (110,110), i.e. the line y = x running through (60, 60).
  function diagonal(): StrokeSnap {
    const doc = new Y.Doc();
    initDoc(doc);
    createStroke(doc, { points: [{ x: 10, y: 10 }, { x: 110, y: 110 }], color: 'black', thickness: 'thin' }, 'me');
    return onlyStroke(doc);
  }

  /** A world point `d` world-units off the line y = x, measured perpendicular to it, near (60, 60). */
  function offLine(d: number): { x: number; y: number } {
    const k = d / Math.SQRT2;
    return { x: 60 - k, y: 60 + k };
  }

  it('hits at 5 screen px and misses at 7, at 50 % and 200 % zoom (the 6 px tolerance)', () => {
    const stroke = diagonal();
    for (const zoom of [0.5, 1, 2]) {
      // A screen distance of `s` pixels is `s / zoom` world units off the line.
      expect(strokeHitTest(stroke, offLine(5 / zoom), zoom)).toBe(true);
      expect(strokeHitTest(stroke, offLine(7 / zoom), zoom)).toBe(false);
    }
  });

  it('is not selected by the empty corner of its box', () => {
    const stroke = diagonal();
    // (10, 110) is inside the bounding box but ~70 world units from the ink.
    expect(strokeHitTest(stroke, { x: 10, y: 110 }, 1)).toBe(false);
  });

  it('is picked through the registry with the same line rule (zoom 1)', () => {
    const stroke = diagonal();
    const spec = getObjectType('stroke')!;
    expect(spec.hitTest(stroke, { x: 60, y: 60 })).toBe(true);
    expect(spec.hitTest(stroke, { x: 10, y: 110 })).toBe(false);
  });
});

describe('aspect-locked resize keeps the ink proportional (story 11)', () => {
  it('scales every point by the same factor when the box grows', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 50, y: 25 }, { x: 100, y: 10 }], color: 'black', thickness: 'medium' },
      'me',
    );
    const stroke = onlyStroke(doc);
    const base = scaledPoints(stroke);

    const stretched: StrokeSnap = { ...stroke, width: stroke.width * 3, height: stroke.height * 3 };
    const scaled = scaledPoints(stretched);
    expect(scaled).toHaveLength(base.length);
    scaled.forEach((p, i) => {
      expect(p.x).toBeCloseTo(base[i]!.x * 3, 3);
      expect(p.y).toBeCloseTo(base[i]!.y * 3, 3);
    });
  });
});

describe('selecting by ink, not by box (story 11 · TC-16)', () => {
  it('a click inside a stroke\'s box but far from its line falls through to the note underneath', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // A note sitting under a diagonal stroke; the click point is inside the stroke's box but far
    // from its ink, so the note is what a click should reach.
    const noteId = createSticky(doc, { x: 120, y: 300 }, 'yellow')!;
    createStroke(doc, { points: [{ x: 10, y: 10 }, { x: 240, y: 400 }], color: 'black', thickness: 'thin' }, 'me');

    const stroke = objectSnapshots(doc).find((s): s is StrokeSnap => s.type === 'stroke')!;
    const note = objectSnapshots(doc).find((s) => s.id === noteId)!;
    const click = { x: 40, y: 360 }; // inside the stroke's box and inside the note, far off the ink

    expect(getObjectType('stroke')!.hitTest(stroke, click)).toBe(false);
    expect(getObjectType(note.type)!.hitTest(note, click)).toBe(true);
  });
});

describe('a selected stroke deleted through the model (story 11 · TC-21)', () => {
  it('is removed cleanly and the stroke type stays registered', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], color: 'black', thickness: 'medium' }, 'me')!;
    expect(objectSnapshots(doc).some((s) => s.id === id)).toBe(true);

    expect(() => deleteObject(doc, id)).not.toThrow();
    expect(objectSnapshots(doc).some((s) => s.id === id)).toBe(false);
    // The type is still registered for the strokes that remain.
    expect(getObjectType('stroke')).toBeDefined();
  });
});

describe('PenToolbar (story 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows six colours and three thicknesses, and reports the choice', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    render(
      <PenToolbar color="blue" thickness="medium" onColor={onColor} onThickness={onThickness} />,
    );

    for (const colour of Object.keys(PEN_COLORS)) {
      const label = colour.charAt(0).toUpperCase() + colour.slice(1);
      expect(screen.getByRole('button', { name: `${label} pen` })).toBeTruthy();
    }
    for (const name of ['Thin', 'Medium', 'Thick']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Red pen' }));
    expect(onColor).toHaveBeenCalledWith('red');
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    expect(onThickness).toHaveBeenCalledWith('thick');
  });

  it('marks the current colour and thickness as pressed', () => {
    render(
      <PenToolbar color="green" thickness="thin" onColor={vi.fn()} onThickness={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Green pen' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Thin' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Thick' }).getAttribute('aria-pressed')).toBe('false');
  });
});

// Referenced so the thickness constant is exercised here too (the default the toolbar starts on).
void PEN_THICKNESS_WORLD.medium;
