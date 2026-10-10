import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteObject } from '../../src/shared/board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { getObjectType, hitTestObjectAt } from '../../src/client/objects/registry';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import type { Point } from '../../src/shared/geometry';
import {
  boardElement,
  createNote,
  createStrokeObject,
  dispatchWheel,
  docNotes,
  docStrokes,
  dragElement,
  editorElement,
  flushFrame,
  noteElement,
  penColorButton,
  penToolbarElement,
  pointerAt,
  pointerEvent,
  pressKey,
  pressPenTool,
  readCamera,
  renderBoard,
  resizeHandleElement,
  resizeHandles,
  screenOf,
  selectionCount,
  strokeElement,
  strokeElements,
  strokeHitElement,
  strokeLineElement,
  strokeOf,
  strokeWorldPoints,
} from './harness';
import { decimate, underlinePath } from '../fixtures/pen-paths';

/**
 * Story 11 task 5 (`stroke.object`, `stroke.hit`): TC-15, TC-16, TC-21.
 *
 * A stroke that exists in the document is rendered by the ordinary object renderer:
 * one `<svg>` per stroke, in its own box, translated by its position, drawn from its
 * own points. What is specific to a stroke is *where a pointer lands on it* - the
 * line, plus a band either side of it that is constant on screen - and that is one
 * function in the registry, which both the board's click routing and the DOM are
 * built from.
 *
 * The camera this board starts with is centred on the jsdom viewport, so the visible
 * world is roughly (-512..512, -384..384) and everything here is placed inside it;
 * `screenOf` converts the world points a pointer is put at.
 */

const colourOf = (color: string): string => PEN_COLORS[color as keyof typeof PEN_COLORS];

const toleranceAt = (thickness: 'thin' | 'medium' | 'thick', zoom: number): number =>
  Math.max(PEN_THICKNESS_WORLD[thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);

/** Where this board's world coordinates have to be for a pointer to reach them. */
const ON_LINE = { x: 200, y: -20 };

/** A straight stroke 200 board units long, from (100, -20) to (300, -20). */
function straightStroke(
  doc: Y.Doc,
  options: { thickness?: 'thin' | 'medium' | 'thick'; color?: 'black' | 'blue' } = {},
): string {
  const id = createStrokeObject(doc, {
    points: [
      { x: 100, y: -20 },
      { x: 150, y: -20 },
      { x: 200, y: -20 },
      { x: 250, y: -20 },
      { x: 300, y: -20 },
    ],
    thickness: options.thickness ?? 'medium',
    color: options.color ?? 'black',
  });
  expect(id).not.toBe('');
  return id;
}

/** The registry's own answer to "is this pointer on this stroke's line?" */
function strokeHitTest(): (obj: StrokeSnap, point: Point, zoom?: number) => boolean {
  const spec = getObjectType('stroke');
  if (!spec) {
    throw new Error('the stroke type is not registered');
  }
  return spec.hitTest as (obj: StrokeSnap, point: Point, zoom?: number) => boolean;
}

/** Press and release the board without moving: a click on the surface itself. */
function clickBoard(at: { x: number; y: number }): void {
  const screen = screenOf(at);
  pointerEvent('pointerdown', screen.x, screen.y);
  pointerEvent('pointerup', screen.x, screen.y);
}

/** Where a rendered handle sits on screen: press its middle. */
function pressHandle(handle: string): { x: number; y: number } {
  const el = resizeHandleElement(handle);
  return { x: Number.parseFloat(el.style.left) + 4, y: Number.parseFloat(el.style.top) + 4 };
}

/** How far a rendered path reaches in x and in y, in the stroke's own units. */
function pathNumbers(element: HTMLElement): { maxX: number; maxY: number } {
  const numbers = (element.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    maxX = Math.max(maxX, numbers[index]!);
    maxY = Math.max(maxY, numbers[index + 1]!);
  }
  return { maxX, maxY };
}

describe('StrokeObject (`stroke.object`, `stroke.hit`)', () => {
  let doc: Y.Doc;

  beforeEach(async () => {
    doc = new Y.Doc();
  });

  it('renders a stroke as one smoothed path in its own box, in its colour and thickness', async () => {
    const path = decimate(underlinePath(), 3).map((point) => ({
      x: point.x - 350,
      y: point.y - 450,
    }));
    const id = createStrokeObject(doc, { points: path, thickness: 'medium' });
    renderBoard({ doc });
    await flushFrame();

    const stroke = strokeOf(doc, id);
    const wrapper = strokeElement(id);
    expect(wrapper.getAttribute('data-color')).toBe('black');
    expect(wrapper.getAttribute('data-thickness')).toBe('medium');
    expect(wrapper.style.transform).toBe(`translate(${stroke.x}px, ${stroke.y}px)`);
    expect(wrapper.style.width).toBe(`${stroke.width}px`);
    expect(wrapper.style.height).toBe(`${stroke.height}px`);
    expect(wrapper.getAttribute('class')).toContain('stroke-object');

    const svg = screen.getByTestId(`stroke-${id}`);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Drawing');
    expect(svg.getAttribute('class')).toContain('stroke-object__svg');

    const line = strokeLineElement(id);
    const d = line.getAttribute('d') ?? '';
    // A path, bent through its recorded points, starting at the first one
    // (`pen.smooth`, `stroke.object`).
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(line.getAttribute('stroke')).toBe(colourOf('black'));
    // The line's own width, in board units: never scaled by the box it is in.
    expect(line.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    // Round ends and joins, which is what makes a one-point stroke a dot.
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    expect(line.getAttribute('stroke-linejoin')).toBe('round');
    // Nothing of the wrapper or the visible line takes a pointer: only the band does.
    expect(line.getAttribute('pointer-events')).toBe('none');

    const hit = strokeHitElement(id);
    expect(hit.getAttribute('stroke-width')).toBe(
      String(toleranceAt('medium', readCamera().zoom) * 2),
    );
    expect(hit.getAttribute('stroke')).toBe('transparent');
    expect(hit.getAttribute('fill')).toBe('none');
    expect(hit.getAttribute('pointer-events')).toBe('stroke');
  });

  it('TC-15: a stroke is hit 5 screen pixels off its line and missed 7 off, at 50% and at 200% (`stroke.hit`)', async () => {
    const id = straightStroke(doc);
    renderBoard({ doc });
    await flushFrame();

    const hitTest = strokeHitTest();
    const stroke = strokeOf(doc, id);

    for (const zoom of [0.5, 2]) {
      // At both zooms the tolerance is the screen one (6 pixels), not the line's own
      // half-thickness - so 5 pixels of screen lands on the line and 7 does not,
      // whichever way the pointer came from.
      expect(toleranceAt('medium', zoom)).toBe(STROKE_HIT_TOLERANCE_PX / zoom);
      const five = 5 / zoom;
      const seven = 7 / zoom;
      expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y + five }, zoom)).toBe(true);
      expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y - five }, zoom)).toBe(true);
      expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y + seven }, zoom)).toBe(false);
      expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y - seven }, zoom)).toBe(false);
    }

    // The same rule is what a real pointer meets in the DOM: the invisible band the
    // click lands on is exactly that wide at the zoom the board is at.
    expect(strokeHitElement(id).getAttribute('stroke-width')).toBe(
      String(toleranceAt('medium', 1) * 2),
    );
  });

  it('the tolerance is measured in screen, so a thin line is as easy to hit at 200% as at 50% (`stroke.hit`)', async () => {
    const id = straightStroke(doc, { thickness: 'thin' });
    renderBoard({ doc });
    await flushFrame();

    const hitTest = strokeHitTest();
    const stroke = strokeOf(doc, id);
    // Half the line's own thickness is 1 board unit; the screen tolerance is bigger at
    // both zooms, so the screen tolerance is what decides.
    expect(PEN_THICKNESS_WORLD.thin / 2).toBe(1);
    expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y + 5 / 0.5 }, 0.5)).toBe(true);
    expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y + 7 / 0.5 }, 0.5)).toBe(false);
    expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y + 5 / 2 }, 2)).toBe(true);
    expect(hitTest(stroke, { x: ON_LINE.x, y: ON_LINE.y + 7 / 2 }, 2)).toBe(false);
  });

  it('TC-16: a click inside a stroke\u0027s box but away from its line does not select the stroke', async () => {
    // A stroke that goes down and then along, leaving a wide empty box - and a note
    // centred in the empty part of it.
    const strokeId = createStrokeObject(doc, {
      points: [
        { x: -260, y: -260 },
        { x: -260, y: -60 },
        { x: -260, y: 140 },
        { x: -60, y: 140 },
        { x: 140, y: 140 },
      ],
    });
    const noteId = createNote(doc, { x: -200, y: -200 });
    renderBoard({ doc });
    await flushFrame();

    const stroke = strokeOf(doc, strokeId);
    const click = { x: -200, y: -200 };
    // The middle of the note, inside the stroke's box, 60 board units from its line.
    expect(click.x).toBeGreaterThan(stroke.x);
    expect(click.x).toBeLessThan(stroke.x + stroke.width);
    expect(click.y).toBeGreaterThan(stroke.y);
    expect(click.y).toBeLessThan(stroke.y + stroke.height);
    const zoom = readCamera().zoom;
    expect(strokeHitTest()(stroke, click, zoom)).toBe(false);

    clickBoard(click);
    await flushFrame();

    expect(noteElement(noteId).getAttribute('data-selected')).toBe('true');
    expect(strokeElement(strokeId).getAttribute('data-selected')).toBe('false');
    expect(selectionCount()).toBe(1);
    // The board's routing agrees with the registry, and the stroke is the object it
    // looked at first: it is the higher one, and it was not hit.
    expect(hitTestObjectAt([...docNotes(doc), strokeOf(doc, strokeId)], click, 1)?.id).toBe(
      noteId,
    );

    // The same kind of click, sixty units along that line, is the opposite answer.
    clickBoard({ x: -260, y: 100 });
    await flushFrame();
    expect(strokeElement(strokeId).getAttribute('data-selected')).toBe('true');
    expect(noteElement(noteId).getAttribute('data-selected')).toBe('false');
  });

  it('clicking a stroke\u0027s line selects it, with resize handles, without the pen (`stroke.object`)', async () => {
    const id = straightStroke(doc);
    renderBoard({ doc });
    await flushFrame();

    clickBoard(ON_LINE);
    await flushFrame();

    expect(strokeElement(id).getAttribute('data-selected')).toBe('true');
    expect(selectionCount()).toBe(1);
    // A finished stroke is an ordinary board object (`sel.all_types`, `sel.transform`):
    // it gets the handles, and a stroke has the corner ones for an aspect-locked box.
    expect(resizeHandles().length).toBe(8);
    expect(resizeHandleElement('se')).not.toBeNull();
    expect(resizeHandleElement('nw')).not.toBeNull();
  });

  it('resizing a stroke scales the whole line in proportion and leaves its thickness alone (`pen.resize`)', async () => {
    const id = straightStroke(doc);
    renderBoard({ doc });
    await flushFrame();

    clickBoard(ON_LINE);
    await flushFrame();

    const before = strokeOf(doc, id);
    const drawnBefore = pathNumbers(strokeLineElement(id));
    const from = pressHandle('se');
    dragElement(resizeHandleElement('se'), from, { x: from.x + 100, y: from.y + 100 }, 4);
    await flushFrame();

    const after = strokeOf(doc, id);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    // In proportion: one factor for both axes, because a drawing is not stretched.
    expect(after.width / before.width).toBeCloseTo(after.height / before.height, 2);
    // The recorded line and the thickness it was drawn with are untouched; the only
    // thing that changed is how far apart the recorded points are drawn.
    expect(after.points).toEqual(before.points);
    expect(after.thickness).toBe(before.thickness);
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.baseHeight).toBe(before.baseHeight);
    expect(strokeLineElement(id).getAttribute('stroke-width')).toBe(
      String(PEN_THICKNESS_WORLD[after.thickness]),
    );
    // And the line drawn in the DOM did get longer, in proportion with the box.
    const drawnAfter = pathNumbers(strokeLineElement(id));
    const scale = after.width / before.width;
    expect(drawnAfter.maxX / drawnBefore.maxX).toBeCloseTo(scale, 2);
    expect(drawnAfter.maxY / drawnBefore.maxY).toBeCloseTo(scale, 2);
  });

  it('a stroke cannot be resized smaller than the line it was drawn with (`pen.resize`)', async () => {
    const id = createStrokeObject(doc, {
      points: [
        { x: 100, y: -60 },
        { x: 160, y: 0 },
      ],
      thickness: 'thick',
    });
    renderBoard({ doc });
    await flushFrame();

    clickBoard({ x: 130, y: -30 });
    await flushFrame();

    const before = strokeOf(doc, id);
    const from = pressHandle('nw');
    dragElement(resizeHandleElement('nw'), from, { x: from.x + 400, y: from.y + 400 }, 6);
    await flushFrame();

    const after = strokeOf(doc, id);
    expect(after.width).toBeLessThan(before.width);
    expect(after.width).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
    expect(after.height).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
  });

  it('dragging a stroke by its line moves it; a press inside its box off the line grabs nothing', async () => {
    const id = straightStroke(doc);
    renderBoard({ doc });
    await flushFrame();

    // On the line: the invisible band is what the pointer lands on, and the board's
    // move gesture takes the stroke (`sel.transform`).
    const onLine = screenOf(ON_LINE);
    dragElement(strokeHitElement(id), onLine, { x: onLine.x + 60, y: onLine.y + 30 }, 4);
    await flushFrame();

    const moved = strokeOf(doc, id);
    expect(moved.x).not.toBe(100);
    expect(moved.y).not.toBe(-20);
    expect(moved.width).toBeCloseTo(200 + PEN_THICKNESS_WORLD.medium, 6);

    // Inside the box but away from the line: nothing is holding the pointer, so the
    // stroke stays where it is (`stroke.hit`, TC-16).
    const before = { x: moved.x, y: moved.y };
    const offLine = screenOf({ x: moved.x + 50, y: moved.y + 40 });
    dragElement(strokeElement(id), offLine, { x: offLine.x + 60, y: offLine.y + 30 }, 4);
    await flushFrame();

    const still = strokeOf(doc, id);
    expect({ x: still.x, y: still.y }).toEqual(before);
  });

  it('TC-21: a stroke deleted while selected leaves the selection with nothing dangling', async () => {
    const id = straightStroke(doc);
    renderBoard({ doc });
    await flushFrame();

    clickBoard(ON_LINE);
    await flushFrame();
    expect(strokeElement(id).getAttribute('data-selected')).toBe('true');
    expect(selectionCount()).toBe(1);
    expect(resizeHandles().length).toBe(8);

    // A remote delete arrives as a document change, with the selection holding it.
    act(() => {
      deleteObject(doc, id);
    });
    await flushFrame();

    expect(strokeElements()).toHaveLength(0);
    expect(docStrokes(doc)).toHaveLength(0);
    expect(selectionCount()).toBe(0);
    expect(resizeHandles()).toHaveLength(0);
    // The board is still there, and still usable.
    expect(screen.getByTestId('app')).not.toBeNull();
    expect(boardElement()).not.toBeNull();
  });

  it('a stroke holds nothing to type: double-clicking it opens no editor (`pen.draw`)', async () => {
    const id = straightStroke(doc);
    renderBoard({ doc });
    await flushFrame();

    const hit = strokeHitElement(id);
    pointerAt(hit, 'pointerdown', 10, 10);
    pointerAt(hit, 'pointerup', 10, 10);
    fireEvent.dblClick(hit, { clientX: 10, clientY: 10 });
    await flushFrame();

    expect(editorElement()).toBeNull();
    expect(docStrokes(doc)).toHaveLength(1);
    expect(strokeOf(doc, id).points.length).toBeGreaterThan(1);
  });

  it('a stroke drawn by someone else appears in place, without reconnecting anything (`pen.share`)', async () => {
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

    renderBoard({ doc });
    await flushFrame();
    expect(strokeElements()).toHaveLength(0);

    // The other person's pen commits, and the change arrives as a document update.
    act(() => {
      createStrokeObject(peer, {
        points: [
          { x: 200, y: -100 },
          { x: 260, y: -40 },
          { x: 320, y: -90 },
        ],
        color: 'green',
        thickness: 'thin',
        createdBy: 'other_client',
      });
    });
    act(() => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateAsUpdate(doc)));
    });
    await flushFrame();

    const strokes = docStrokes(doc);
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    expect(stroke.color).toBe('green');
    expect(stroke.createdBy).toBe('other_client');
    expect(strokeElement(stroke.id)).not.toBeNull();
    expect(strokeLineElement(stroke.id).getAttribute('stroke')).toBe(colourOf('green'));
    expect(strokeWorldPoints(stroke).length).toBeGreaterThan(1);
  });

  it('the line keeps its board thickness as the board zooms, and the click band grows (`stroke.hit`)', async () => {
    const id = straightStroke(doc);
    renderBoard({ doc });
    await flushFrame();

    const before = strokeLineElement(id).getAttribute('stroke-width');
    expect(before).toBe(String(PEN_THICKNESS_WORLD.medium));
    const zoomBefore = readCamera().zoom;
    const widthBefore = strokeOf(doc, id).width;

    dispatchWheel(boardElement(), { deltaY: -120, ctrlKey: true });
    await flushFrame();

    const zoomAfter = readCamera().zoom;
    expect(zoomAfter).not.toBe(zoomBefore);
    // The path is drawn in board units and scaled by the world layer with everything
    // else: neither the attribute nor the box changes.
    expect(strokeLineElement(id).getAttribute('stroke-width')).toBe(before);
    expect(strokeElement(id).style.width).toBe(`${widthBefore}px`);
    // What does change is the invisible band, so that it stays 6 screen pixels wide.
    expect(strokeHitElement(id).getAttribute('stroke-width')).toBe(
      String(toleranceAt('medium', zoomAfter) * 2),
    );
  });

  it('the pen toolbar is only there while the pen is in hand, and the strokes stay', async () => {
    const id = straightStroke(doc, { color: 'blue' });
    renderBoard({ doc });
    await flushFrame();

    pressPenTool();
    await flushFrame();
    expect(penToolbarElement()).not.toBeNull();
    fireEvent.click(penColorButton('red'));

    pressKey('v');
    await flushFrame();

    expect(penToolbarElement()).toBeNull();
    expect(strokeElement(id)).not.toBeNull();
    expect(strokeOf(doc, id).color).toBe('blue');
    expect(strokeLineElement(id).getAttribute('stroke')).toBe(colourOf('blue'));
  });
});
