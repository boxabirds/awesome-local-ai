/**
 * Story 11 component tests — pen.tool_ui (TC-09), pen.draw (TC-10),
 * pen.options (TC-11), pen.long_stroke (TC-12), pen.dot (TC-13) and
 * pen.error_paths (TC-14) in the real board, plus pen.cursor.
 *
 * jsdom assumptions (as in the other component tests): a 1024x768 window,
 * the initial camera is resetCamera(viewport), so world (0,0) sits at screen
 * (512,384) and world = screen - (512,384) at zoom 1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { allObjects } from 'src/shared/board-model';
import { getStroke, scaledPoints } from 'src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from 'src/shared/config';
import type { Point } from 'src/shared/geometry';
import { longSpiral } from '../fixtures/pen-paths';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

function selectButton(): HTMLElement {
  return screen.getByTestId('select-tool-button');
}
function penButton(): HTMLElement {
  return screen.getByTestId('pen-tool-button');
}
function penLayer(): HTMLElement {
  return screen.getByTestId('pen-tool-layer');
}
function strokes(doc: Y.Doc): string[] {
  return allObjects(doc)
    .filter((o) => o.type === 'stroke')
    .map((o) => o.id);
}

/** world → screen at the initial camera (zoom 1, world origin at 512,384). */
const toScreen = (p: Point) => ({ x: p.x + 512, y: p.y + 384 });

describe('pen.tool_ui / pen.draw / pen.options (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-09: P activates the Pen tool (layer + options panel appear); V and Escape return to Select; the button mirrors the state', async () => {
    // Initial: Select active, no pen layer, no pen toolbar.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(penButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();

    const user = userEvent.setup();
    // P activates the Pen tool: the layer and the options panel appear.
    await user.keyboard('p');
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('pen-tool-layer')).toBeTruthy();
    expect(screen.getByTestId('pen-toolbar')).toBeTruthy();

    // V returns to Select: the layer and panel go away.
    await user.keyboard('v');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(penButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();

    // The toolbar button activates the tool too.
    fireEvent.click(penButton());
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pen-tool-layer')).toBeTruthy();

    // Escape returns to Select.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(penButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('pen-tool-layer')).toBeNull();
  });

  it('TC-10: a drag draws exactly one stroke at the drag path; the tool STAYS active on pen; pen-cursor and preview render', async () => {
    const doc = getDoc();

    const user = userEvent.setup();
    await user.keyboard('p');
    const layer = penLayer();

    // Drag screen (612,434) → (712,494) → (812,554):
    // world (100,50) → (200,110) → (300,170) (a straight line).
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerMove(layer, { clientX: 712, clientY: 494 });

    // The live preview path is visible while dragging ...
    expect(screen.getByTestId('pen-preview')).toBeTruthy();
    // ... and the custom pen cursor tracks the pointer (medium = 4 px at zoom 1).
    const cursor = screen.getByTestId('pen-cursor');
    expect(cursor).toBeTruthy();

    fireEvent.pointerUp(layer, { button: 0, clientX: 812, clientY: 554 });

    // Exactly one object: a stroke over the drag path's bounds, padded by
    // thickness/2 (medium = 4 → 2 on each side).
    const objects = allObjects(doc);
    expect(objects).toHaveLength(1);
    const [stroke] = objects;
    expect(stroke.type).toBe('stroke');
    expect(stroke.x).toBe(98);
    expect(stroke.y).toBe(48);
    expect(stroke.width).toBe(204);
    expect(stroke.height).toBe(124);
    // The middle point is collinear → simplified away (2 stored points).
    const s = getStroke(doc, stroke.id)!;
    expect(s.points).toHaveLength(4);
    expect(s.color).toBe('black');
    expect(s.thickness).toBe('medium');
    // Endpoints of the simplified line (world coordinates).
    const pts = scaledPoints(s);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ x: 100, y: 50 });
    expect(pts[1]).toEqual({ x: 300, y: 170 });

    // The stroke renders, is NOT selected (the pen keeps sketching) ...
    const el = screen.getByTestId('stroke-object');
    expect(el).not.toHaveAttribute('data-selected');
    // ... the preview and pen cursor are gone after the commit ...
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    // ... and the tool STAYS active on pen.
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pen-tool-layer')).toBeTruthy();
  });

  it('TC-11: picking purple+Thick then red+Thin applies to the NEXT stroke only', async () => {
    const doc = getDoc();

    const user = userEvent.setup();
    await user.keyboard('p');
    const layer = penLayer();

    // Pick purple + Thick.
    fireEvent.click(screen.getByLabelText('purple pen'));
    fireEvent.click(screen.getByLabelText('Thick'));
    expect(screen.getByLabelText('purple pen')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Thick')).toHaveAttribute('aria-pressed', 'true');

    // Stroke 1 (world (100,50) → (300,170)).
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerMove(layer, { clientX: 712, clientY: 494 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 812, clientY: 554 });
    const [first] = allObjects(doc);
    const s1 = getStroke(doc, first.id)!;
    expect(s1.color).toBe('purple');
    expect(s1.thickness).toBe('thick');

    // Pick red + Thin and draw stroke 2 (world (0,-100) → (150,-50)).
    fireEvent.click(screen.getByLabelText('red pen'));
    fireEvent.click(screen.getByLabelText('Thin'));
    expect(screen.getByLabelText('red pen')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Thin')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerDown(layer, { button: 0, clientX: 512, clientY: 284 });
    fireEvent.pointerMove(layer, { clientX: 582, clientY: 309 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 662, clientY: 334 });

    // Two strokes; the new one is red/Thin, the first is unchanged.
    expect(strokes(doc)).toHaveLength(2);
    const s1Again = getStroke(doc, first.id)!;
    expect(s1Again.color).toBe('purple');
    expect(s1Again.thickness).toBe('thick');
    const second = allObjects(doc).find((o) => o.id !== first.id)!;
    const s2 = getStroke(doc, second.id)!;
    expect(s2.color).toBe('red');
    expect(s2.thickness).toBe('thin');
    // Thickness affects the bbox padding: thin = 2 → 1 on each side.
    expect(second.width).toBe(150 + 2);
    expect(second.height).toBe(50 + 2);
  });

  it('TC-12: a 5,010-move stroke splits into 2 strokes, each ≤ STROKE_MAX_POINTS points, seamless at the join', async () => {
    const doc = getDoc();

    const user = userEvent.setup();
    await user.keyboard('p');
    const layer = penLayer();

    // Replay the recorded 5,010-point spiral (STROKE_MAX_POINTS + 10):
    // pointer down at the first point, one move per remaining point.
    const down = toScreen(longSpiral[0]);
    fireEvent.pointerDown(layer, { button: 0, clientX: down.x, clientY: down.y });
    for (let i = 1; i < longSpiral.length; i++) {
      const s = toScreen(longSpiral[i]);
      fireEvent.pointerMove(layer, { clientX: s.x, clientY: s.y });
    }
    const up = toScreen(longSpiral[longSpiral.length - 1]);
    fireEvent.pointerUp(layer, { button: 0, clientX: up.x, clientY: up.y });

    // Exactly 2 strokes ...
    const ids = strokes(doc);
    expect(ids).toHaveLength(2);
    const a = getStroke(doc, ids[0])!;
    const b = getStroke(doc, ids[1])!;
    // ... each with at most STROKE_MAX_POINTS points (simplified, so fewer).
    expect(a.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(b.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    // ... and they join seamlessly: part 2 starts where part 1 ends.
    const endA = scaledPoints(a);
    const startB = scaledPoints(b);
    expect(endA[endA.length - 1]).toEqual(startB[0]);
    // The parts together cover the whole spiral (first start, last end;
    // near-equal: screen-pixel round-trips add ≤ half a world unit).
    const expectPt = (actual: Point, expected: Point) => {
      expect(actual.x).toBeCloseTo(expected.x, 0);
      expect(actual.y).toBeCloseTo(expected.y, 0);
    };
    const startA = scaledPoints(a);
    expectPt(startA[0], longSpiral[0]);
    expectPt(endA[endA.length - 1], longSpiral[STROKE_MAX_POINTS - 1]);
    expectPt(startB[0], longSpiral[STROKE_MAX_POINTS - 1]);
    expectPt(startB[startB.length - 1], longSpiral[longSpiral.length - 1]);
  });

  it('TC-13: a click with no movement draws a round dot (a single-point stroke of the thickness size)', async () => {
    const doc = getDoc();

    const user = userEvent.setup();
    await user.keyboard('p');
    const layer = penLayer();

    // Click (no movement) at screen (612,434) = world (100,50).
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 612, clientY: 434 });

    const objects = allObjects(doc);
    expect(objects).toHaveLength(1);
    const [stroke] = objects;
    expect(stroke.type).toBe('stroke');
    const t = PEN_THICKNESS_WORLD[stroke.thickness as keyof typeof PEN_THICKNESS_WORLD];
    // A thickness square centred on the click point.
    expect(stroke.x).toBe(100 - t / 2);
    expect(stroke.y).toBe(50 - t / 2);
    expect(stroke.width).toBe(t);
    expect(stroke.height).toBe(t);
    // One stored point.
    const s = getStroke(doc, stroke.id)!;
    expect(s.points).toHaveLength(2);
    expect(scaledPoints(s)).toEqual([{ x: 100, y: 50 }]);
    // The dot renders.
    expect(screen.getByTestId('stroke-object')).toBeTruthy();
  });

  it('TC-14: a pointercancel after 3 moves commits the 4 drawn points (tab switch)', async () => {
    const doc = getDoc();

    const user = userEvent.setup();
    await user.keyboard('p');
    const layer = penLayer();

    // 4 non-collinear points: world (100,50) → (150,100) → (200,80) → (250,120).
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerMove(layer, { clientX: 662, clientY: 484 });
    fireEvent.pointerMove(layer, { clientX: 712, clientY: 464 });
    fireEvent.pointerMove(layer, { clientX: 762, clientY: 504 });
    fireEvent.pointerCancel(layer);

    // The points drawn so far are committed as one stroke (all 4 kept).
    const objects = allObjects(doc);
    expect(objects).toHaveLength(1);
    const s = getStroke(doc, objects[0].id)!;
    expect(s.points).toHaveLength(8);
  });
});
