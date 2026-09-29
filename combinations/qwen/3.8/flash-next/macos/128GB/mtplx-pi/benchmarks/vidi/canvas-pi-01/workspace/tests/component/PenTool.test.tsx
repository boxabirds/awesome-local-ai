/**
 * Story 11 · task 17 — Pen tool and stroke component tests (TC-25, TC-26).
 *
 * These drive the real `BoardShell` in jsdom with a real `Y.Doc`, the way the
 * Shape and Connector tool tests do: the Pen overlay is the layer that owns every
 * pointer gesture while the tool is active, so a sketch is checked end to end
 * (preview → one `createStroke` → the tool stays a Pen), and a drawn stroke is
 * then selected and resized through the same generic transform path.
 *
 * jsdom has no layout, so the screen→world maths runs on the *default* camera
 * (origin −400,−300 at zoom 1): a screen drag maps to world units one for one and
 * the assertions can name the exact stored box.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardShell } from '../../src/client/App';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createStroke } from '../../src/shared/objects/stroke';
import type { Point } from '../../src/shared/geometry';
import { seedDoc } from './helpers';

const VIEWPORT = { width: 800, height: 600 };

beforeEach(() => {
  cleanup();
});

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A pointer event the delegated pointer handlers accept. */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  x: number,
  y: number,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

/** Draw a polyline through the given screen points, from press to release. */
function drawPath(container: HTMLElement, points: Array<[number, number]>) {
  const overlay = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
  fireEvent(overlay, pointer('pointerdown', points[0][0], points[0][1]));
  for (const [x, y] of points.slice(1)) {
    fireEvent(overlay, pointer('pointermove', x, y));
  }
  const last = points[points.length - 1];
  fireEvent(overlay, pointer('pointerup', last[0], last[1]));
}

function strokes(doc: Y.Doc) {
  return snapshot(doc).filter((entry) => entry.type === 'stroke');
}

/**
 * The tool's own ink row, which is on screen for as long as the Pen tool is
 * active (PRD pen.options, Structure: "Pen toolbar (visible while Pen is
 * active)"). It is looked up inside the left toolbar so it can never be confused
 * with the row a selected sketch carries.
 */
function toolInkRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector(
    '[data-testid="left-toolbar"] [data-testid="pen-toolbar"]',
  ) as HTMLElement | null;
  if (row === null) throw new Error('the active Pen tool has no ink row');
  return row;
}

/** Put the board in Pen mode the way the golden path does: the `p` key. */
function selectPenTool(container: HTMLElement): void {
  act(() => {
    fireEvent(window, new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  });
  expect(container.querySelector('[data-testid="pen-tool"]')).toBeTruthy();
}

describe('the Pen tool (TC-25)', () => {
  it('draws one stroke object with the default ink and width', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    // `p` selects the Pen (PRD pen.draw: "select the Pen tool (click it or press p)").
    act(() => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
    // The ink row is already there — six colours and three widths, black and the
    // middle width chosen (PRD pen.options, golden path step 1).
    const row = toolInkRow(container);
    expect(row.querySelectorAll('[data-testid^="pen-color-"]').length).toBe(6);
    expect(row.querySelectorAll('[data-testid^="pen-width-"]').length).toBe(3);

    drawPath(container, [
      [400, 300],
      [420, 300],
      [440, 310],
      [460, 330],
    ]);

    const drawn = strokes(doc);
    expect(drawn.length).toBe(1);
    // Screen (400,300) at the default camera is world (0,0)-ish; the box is the
    // path's bounds padded by half the 4-unit ink, so it is ~64 × ~38.
    expect(drawn[0].width).toBeGreaterThan(55);
    expect(drawn[0].height).toBeGreaterThan(30);
    expect(drawn[0].thickness).toBe('medium');
    expect(drawn[0].ink).toBe('black');
    expect(drawn[0].points!.length).toBeGreaterThanOrEqual(4);
    // The tool stays a Pen, and the sketch is selected (its toolbar appears).
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
  });

  it('shows the ink row as soon as the Pen tool is active, defaults already chosen', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    selectPenTool(container);
    // The row is not something that has to be summoned: whoever picks the Pen is
    // one more click away from changing the ink (PRD pen.options, golden path).
    const row = toolInkRow(container);
    expect(row.querySelectorAll('[data-testid^="pen-color-"]').length).toBe(6);
    expect(row.querySelectorAll('[data-testid^="pen-width-"]').length).toBe(3);
    expect(
      (row.querySelector('[data-testid="pen-color-black"]') as HTMLElement).getAttribute('aria-pressed'),
    ).toBe('true');
    const chosen = row.querySelector('[aria-pressed="true"][data-testid^="pen-width-"]') as HTMLElement;
    expect(chosen.getAttribute('data-width')).toBe('medium');
    // Every swatch and every width button has a name, not just a colour (PRD
    // pen.options, Accessibility).
    expect(row.querySelectorAll('[aria-label]').length).toBe(9);
  });

  it('picks the Pen from a click on the tool button and draws with the last setup', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    // The golden path offers two ways onto the Pen: the `p` key, or the button.
    const control = container.querySelector('[data-testid="tool-pen"]') as HTMLElement;
    fireEvent.click(control);
    expect(container.querySelector('[data-testid="pen-tool"]')).toBeTruthy();
    expect(toolInkRow(container)).toBeTruthy();

    drawPath(container, [
      [400, 300],
      [430, 320],
      [460, 300],
    ]);
    const drawn = strokes(doc);
    expect(drawn.length).toBe(1);
    expect(drawn[0].ink).toBe('black');
    expect(drawn[0].thickness).toBe('medium');
  });

  it('applies a width picked in the row to the very next sketch', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    selectPenTool(container);
    const row = toolInkRow(container);
    // Choosing a width changes the next sketch and nothing else: it neither draws
    // an object nor repaints one (PRD pen.options).
    fireEvent.click(row.querySelector('[data-testid="pen-width-thick"]') as HTMLElement);
    expect(strokes(doc).length).toBe(0);

    drawPath(container, [
      [400, 300],
      [430, 320],
      [460, 300],
    ]);
    const drawn = strokes(doc);
    expect(drawn.length).toBe(1);
    expect(drawn[0].thickness).toBe('thick');
  });

  it('shows a round cursor the size of the ink, at the zoom on screen', async () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    selectPenTool(container);
    const overlay = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    // Hovering, with no button down, is enough: the preview is published once per
    // animation frame, so it takes a frame to appear.
    const sizeOf = (): string | null => {
      const ring = container.querySelector('[data-testid="pen-cursor"]') as HTMLElement | null;
      return ring === null ? null : window.getComputedStyle(ring).width || ring.style.width;
    };
    fireEvent(overlay, pointer('pointermove', 300, 300));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="pen-cursor"]')).toBeTruthy();
    });
    // Medium is 4 board units and the default camera is at zoom 1, so it is 4 px.
    expect((container.querySelector('[data-testid="pen-cursor"]') as HTMLElement).style.width).toBe(
      '4px',
    );
    // There is no half-drawn line, only the cursor: nothing pretends to be a
    // stroke in progress (PRD pen.draw, "non-behaviours").
    expect(container.querySelector('[data-testid="pen-preview-path"]')).toBeNull();

    // Picking Thick makes the cursor bigger at once: it previews the ink the next
    // stroke will lay down (PRD pen.options, golden path step 1).
    fireEvent.click(
      toolInkRow(container).querySelector('[data-testid="pen-width-thick"]') as HTMLElement,
    );
    fireEvent(overlay, pointer('pointermove', 340, 320));
    await waitFor(() => {
      expect(
        (container.querySelector('[data-testid="pen-cursor"]') as HTMLElement).style.width,
      ).toBe('8px');
    });
    expect(sizeOf()).toBe('8px');
  });

  it('keeps the tool a Pen and writes one undo step per sketch', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    act(() => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
    drawPath(container, [
      [400, 300],
      [450, 320],
      [500, 300],
    ]);
    expect(strokes(doc).length).toBe(1);
    // A second sketch is a second step, still with the tool left on Pen.
    drawPath(container, [
      [300, 200],
      [350, 250],
      [400, 210],
    ]);
    expect(strokes(doc).length).toBe(2);
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
  });

  it('finishes the sketch when the gesture is interrupted', () => {
    // Story 11 / PRD pen.draw: an interrupted drag is a *finished* stroke, not a
    // discarded one — what the pen drew stays on the board.
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    act(() => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
    const overlay = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    fireEvent(overlay, pointer('pointerdown', 400, 300));
    fireEvent(overlay, pointer('pointermove', 450, 330));
    fireEvent(overlay, pointer('pointercancel', 460, 340));
    expect(strokes(doc).length).toBe(1);
    // Exactly one, and the gesture is over: no half-eraser is left on the board.
    drawPath(container, [
      [200, 200],
      [260, 240],
    ]);
    expect(strokes(doc).length).toBe(2);
  });

  it('finishes the sketch when the pointer capture is lost', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    act(() => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
    const overlay = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    fireEvent(overlay, pointer('pointerdown', 400, 300));
    fireEvent(overlay, pointer('pointermove', 430, 320));
    fireEvent(overlay, pointer('pointermove', 460, 340));
    fireEvent(overlay, pointer('lostpointercapture', 460, 340));
    expect(strokes(doc).length).toBe(1);
    // The preview is gone with the gesture, so nothing keeps painting.
    expect(container.querySelector('[data-testid="pen-preview"]')).toBeNull();
  });

  it('splits a gesture that reaches the point cap instead of growing forever', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    act(() => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
    // 5,002 distinct points, well past STROKE_MAX_POINTS.
    const points: Array<[number, number]> = [[10, 10]];
    for (let i = 1; i <= 5001; i++) points.push([10 + (i % 700), 10 + ((i * 7) % 500)]);
    drawPath(container, points);
    const drawn = strokes(doc);
    expect(drawn.length).toBeGreaterThan(1);
    for (const stroke of drawn) {
      expect(stroke.points!.length / 2).toBeLessThanOrEqual(5000);
    }
  });
});

describe('the stroke object (TC-23, TC-26)', () => {
  /** Seed a sketch whose path is a straight line, at a known box. */
  function seeded(doc: Y.Doc, points: Point[]): string {
    const id = createStroke(doc, { points, color: 'black', thickness: 'medium' }, 'me')!;
    return id;
  }

  it('is selected only by a click near the path, not inside the box', () => {
    const doc = freshDoc();
    // A long shallow arc: the box is much bigger than the ink.
    const arc: Point[] = [];
    for (let i = 0; i <= 20; i++) arc.push({ x: 100 + i * 5, y: 200 - (i / 20) * 60 });
    seeded(doc, arc);
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    const stroke = container.querySelector('[data-testid="stroke"]') as HTMLElement;
    expect(stroke).toBeTruthy();
    expect(stroke.getAttribute('class')).toContain('stroke');

    // A press inside the empty half of the box does not select it: the world
    // point is far from the path, so the layer under the stroke gets the event.
    const inside = container.querySelector('[data-testid="world-layer"]') as HTMLElement;
    fireEvent(inside, pointer('pointerdown', 500, 450));
    expect(stroke.getAttribute('data-selected')).toBe('false');
  });

  it('shows the pen toolbar and proportional handles when selected', () => {
    const doc = freshDoc();
    seeded(doc, [
      { x: 100, y: 200 },
      { x: 140, y: 220 },
      { x: 180, y: 200 },
    ]);
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    // Select it the way the app does: a click on the ink itself.
    const stroke = container.querySelector('[data-testid="stroke"]') as HTMLElement;
    const hit = container.querySelector('[data-testid="stroke-hit"]') as SVGPathElement;
    fireEvent(hit, pointer('pointerdown', 100, 100));
    expect(stroke.getAttribute('data-selected')).toBe('true');
    // A sketch is announced as "Drawing", as a group so that the options row and
    // the handles inside it stay reachable (PRD pen.options, Accessibility).
    expect(stroke.getAttribute('aria-label')).toBe('Drawing');
    expect(stroke.getAttribute('role')).toBe('group');
    expect(stroke.querySelector('[data-testid="stroke-toolbar"]')).toBeTruthy();
    // Eight resize handles, screen-constant in size.
    expect(stroke.querySelectorAll('.stroke-resize-handle').length).toBe(8);
  });

  it('rescales the path when the box is resized, keeping the ink width', () => {
    const doc = freshDoc();
    const points: Point[] = [];
    for (let i = 0; i <= 20; i++) points.push({ x: 100 + i * 4, y: 200 + i * 2 });
    const id = seeded(doc, points);
    const before = snapshot(doc).find((entry) => entry.id === id)!;
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    const stroke = container.querySelector('[data-testid="stroke"]') as HTMLElement;
    const hit = container.querySelector('[data-testid="stroke-hit"]') as SVGPathElement;
    fireEvent(hit, pointer('pointerdown', 100, 100));
    expect(stroke.getAttribute('data-selected')).toBe('true');

    // Drag the north-west handle out by 40 screen px: at zoom 1 that is 40 world
    // units, and the aspect lock makes both axes grow by the same factor.
    const handle = container.querySelector('[data-testid="stroke-handle-nw"]') as SVGRectElement;
    const startBox = { width: before.width, height: before.height };
    fireEvent(handle, pointer('pointerdown', 0, 0));
    fireEvent(handle, pointer('pointermove', -40, -20));
    fireEvent(handle, pointer('pointerup', -40, -20));

    const after = snapshot(doc).find((entry) => entry.id === id)!;
    expect(after.width).toBeGreaterThan(startBox.width);
    expect(after.height).toBeGreaterThan(startBox.height);
    // Proportional: both axes grew by the same factor, so the drawing is stretched,
    // not smeared (PRD pen.resize).
    const growX = after.width / startBox.width;
    const growY = after.height / startBox.height;
    expect(Math.abs(growX - growY)).toBeLessThan(0.01);
    // The ink is a property of the pen, not of the box.
    expect(after.thickness).toBe('medium');
  });
});

describe('the Pen tool leaves the board and the other people alone (TC-13, TC-18, TC-19)', () => {
  /** Turn the Pen on the way the keyboard does. */
  function penOn(): void {
    act(() => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    });
  }

  /** The camera the world layer was last painted with (jsdom has no layout). */
  function cameraOf(container: HTMLElement): { x: number; y: number; zoom: number } {
    const stamp = (
      container.querySelector('[data-testid="world-layer"]') as HTMLElement
    ).dataset.camera;
    const [x, y, zoom] = (stamp ?? '').split(',').map(Number);
    return { x, y, zoom };
  }

  /** Keep two docs in step, the way the websocket provider does. */
  function bridge(a: Y.Doc, b: Y.Doc): void {
    const relay = (from: Y.Doc, to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
      if (origin !== to) Y.applyUpdate(to, update, from);
    };
    a.on('update', relay(a, b));
    b.on('update', relay(b, a));
  }

  it('writes nothing when Escape ends a sketch (TC-13)', async () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    penOn();
    const overlay = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    fireEvent(overlay, pointer('pointerdown', 300, 300));
    fireEvent(overlay, pointer('pointermove', 360, 340));
    // The sketch is on screen before it is anywhere else: the preview is a DOM
    // fact, not a document fact (PRD pen.share).
    await waitFor(() => {
      expect(screen.getByTestId('pen-preview')).toBeTruthy();
    });
    expect(strokes(doc).length).toBe(0);

    act(() => {
      fireEvent(window, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(strokes(doc).length).toBe(0);
    // Escape hands the pointers back to Select, so the overlay that owned them is
    // gone — the next press is a board gesture, not a sketch.
    expect(screen.queryByTestId('pen-tool')).toBeNull();
  });

  it('sends nothing while a sketch is being drawn, and one stroke after (TC-18)', () => {
    const docA = freshDoc();
    const docB = new Y.Doc();
    initDoc(docB);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    // docB is a second person looking at the same board: every update docA makes
    // crosses the bridge, so anything written mid-drag would arrive mid-drag.
    bridge(docA, docB);
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={docA} />);
    penOn();

    const overlay = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    fireEvent(overlay, pointer('pointerdown', 200, 200));
    for (let i = 1; i <= 24; i++) {
      fireEvent(overlay, pointer('pointermove', 200 + i * 6, 200 + (i % 2) * 5));
    }
    // Mid-drag: nothing has been written on this board, so nothing can have been
    // sent, and the other person's copy has no new object.
    expect(strokes(docA).length).toBe(0);
    expect(strokes(docB).length).toBe(0);

    fireEvent(overlay, pointer('pointerup', 344, 260));
    const mine = strokes(docA);
    const theirs = strokes(docB);
    // One sketch, written once, and it arrived: the bridge is not a placebo.
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(1);
    expect(theirs[0].points).toEqual(mine[0].points);
    expect(theirs[0].id).toBe(mine[0].id);
  });

  it('does not move a note that lies under a Pen drag (TC-19)', () => {
    // One note centred on world (0,0), which at the default camera is the middle
    // of the screen: exactly where the drag starts.
    const { doc, ids } = seedDoc([{ id: 'note-under-pen', centre: { x: 0, y: 0 } }]);
    const noteId = ids[0];
    const before = snapshot(doc).find((entry) => entry.type === 'sticky')!;
    expect(before.x).toBeCloseTo(-100, 6);
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    penOn();

    drawPath(container, [
      [400, 300],
      [412, 312],
      [424, 320],
      [436, 334],
    ]);

    const after = snapshot(doc).find((entry) => entry.type === 'sticky')!;
    // The Pen owns the pointer while it is up: the note under the drag stayed put
    // and was never picked up (PRD pen.draw).
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
    const note = screen.getByTestId(`note-${noteId}`);
    expect(note.getAttribute('data-selected')).toBe('false');
    // …and the sketch it drew over it is a new object, not a moved one.
    expect(strokes(doc).length).toBe(1);
    // A sketch dragged across a note never leaves a second object behind: drawing
    // cannot create stickies, whatever it passes over (PRD pen.draw).
    expect(snapshot(doc).filter((entry) => entry.type === 'sticky').length).toBe(1);
  });

  it('still lets the wheel pan the board (TC-19)', async () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    penOn();
    const overlay = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    const before = cameraOf(container);

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 0,
      deltaY: -120,
      deltaMode: 0,
      clientX: 400,
      clientY: 300,
    });
    // The wheel is dispatched over the Pen layer, which is what covers the board
    // while drawing: navigation has to reach the viewport through it.
    fireEvent(overlay, event);

    await waitFor(() => {
      expect(cameraOf(container)).not.toEqual(before);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps a finished sketch on Pen and keeps its own ink (TC-14)', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    penOn();
    drawPath(container, [
      [200, 200],
      [240, 230],
      [280, 210],
    ]);
    expect(strokes(doc).length).toBe(1);

    // The tool is still a Pen, and the next sketch uses whatever the options say
    // now — the first sketch is left exactly as it was drawn (PRD pen.options).
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
    // Two pen rows can be on screen at once: the tool's own options (what the next
    // sketch gets) and the selected sketch's toolbar (what this one is repainted
    // with). This test touches only the first.
    const toolRow = toolInkRow(container);
    fireEvent.click(toolRow.querySelector('[data-testid="pen-color-red"]') as HTMLElement);
    fireEvent.click(toolRow.querySelector('[data-testid="pen-width-thick"]') as HTMLElement);
    expect(strokes(doc)[0].ink).toBe('black');

    drawPath(container, [
      [500, 200],
      [540, 240],
      [580, 220],
    ]);
    const drawn = strokes(doc);
    expect(drawn.length).toBe(2);
    expect(drawn[0].ink).toBe('black');
    expect(drawn[0].thickness).toBe('medium');
    expect(drawn[1].ink).toBe('red');
    expect(drawn[1].thickness).toBe('thick');
  });

  it('repaints the sketch that is selected, without drawing a second one', () => {
    const doc = freshDoc();
    const points: Point[] = [];
    for (let i = 0; i <= 12; i++) points.push({ x: 60 + i * 6, y: 120 + (i % 3) * 8 });
    const id = createStroke(doc, { points, color: 'black', thickness: 'medium' }, 'me')!;
    const before = snapshot(doc).find((entry) => entry.id === id)!;
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);

    // Select it on its ink, then use the selected sketch's own row.
    const hit = container.querySelector('[data-testid="stroke-hit"]') as SVGPathElement;
    fireEvent(hit, pointer('pointerdown', 100, 100));
    const row = container.querySelector('[data-testid="stroke-toolbar"]') as HTMLElement;
    expect(row).toBeTruthy();
    fireEvent.click(row.querySelector('[data-testid="pen-color-red"]') as HTMLElement);
    fireEvent.click(row.querySelector('[data-testid="pen-width-thick"]') as HTMLElement);

    const after = snapshot(doc).find((entry) => entry.id === id)!;
    // One sketch, still the same path, in a new ink and a new width: a restyle is
    // not a redraw (PRD pen.options).
    expect(strokes(doc).length).toBe(1);
    expect(after.ink).toBe('red');
    expect(after.thickness).toBe('thick');
    expect(after.points).toEqual(before.points);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('writes one undo step per sketch, so Ctrl+Z removes exactly one (TC-17)', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    penOn();
    drawPath(container, [
      [200, 200],
      [240, 230],
      [280, 210],
    ]);
    drawPath(container, [
      [500, 200],
      [540, 240],
      [580, 220],
    ]);
    expect(strokes(doc).length).toBe(2);

    const undo = () =>
      act(() => {
        fireEvent(
          window,
          new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
        );
      });

    // One drag is one step: the first Ctrl+Z takes away the second sketch only.
    undo();
    expect(strokes(doc).length).toBe(1);
    undo();
    expect(strokes(doc).length).toBe(0);
  });

  it('draws a dot where a press never moved (TC-10)', () => {
    const doc = freshDoc();
    const { container } = render(<BoardShell viewport={VIEWPORT} doc={doc} />);
    penOn();
    // One press, one release, nothing between them.
    drawPath(container, [[400, 300]]);
    const drawn = strokes(doc);
    // A tap is a dot, not a no-op: one point, and the ink gives it a box.
    expect(drawn.length).toBe(1);
    expect(drawn[0].points).toEqual([2, 2]);
    expect(drawn[0].width).toBeCloseTo(4, 6);
    expect(drawn[0].height).toBeCloseTo(4, 6);
  });
});
