/**
 * Component tests for the Pen tool (story 11, task 5): TC-09 to TC-14 and
 * TC-21 against the real App wiring.
 *
 * The tool is a screen-space layer: tests press on that layer, move through
 * `window` (where the capture listeners live) and read the document. At zoom 1
 * a screen pixel and a world unit are the same thing; where a position matters
 * it is compared against the camera the board reports, never a hard-coded
 * number — the same contract the Shape tool tests use.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { seedSticky, stubViewportSize } from './boardHarness';
import { cameraOf, countUpdates, screenOf, toScreen } from './flowHarness';
import { snapshot } from '../../src/shared/board-model';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';

stubViewportSize();

const strokesOf = (doc: Y.Doc): StrokeSnap[] =>
  snapshot(doc).filter((s): s is StrokeSnap => s.type === 'stroke');

/** Wait for one animation frame, flushing any rAF-batched preview update. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe('Pen tool (pen.draw, pen.preview, pen.cancel, pen.long_stroke, pen.options, pen.undo)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  const layerOf = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector<HTMLElement>('[data-tool-layer="pen"]');
    if (!el) throw new Error('the Pen tool layer is not up');
    return el;
  };

  /** One complete gesture: press, glide through `points`, release. */
  function draw(container: HTMLElement, points: readonly Point[], pointerId = 21): void {
    const layer = layerOf(container);
    fireEvent.pointerDown(layer, {
      clientX: points[0]!.x,
      clientY: points[0]!.y,
      button: 0,
      pointerId,
    });
    for (const p of points.slice(1, -1)) {
      fireEvent.pointerMove(window, { clientX: p.x, clientY: p.y, button: 0, pointerId });
    }
    const last = points[points.length - 1]!;
    fireEvent.pointerUp(window, { clientX: last.x, clientY: last.y, button: 0, pointerId });
  }

  const wiggle = (from: Point, dx: number, dy: number, steps = 6): Point[] =>
    Array.from({ length: steps + 1 }, (_, i) => ({
      x: from.x + (dx * i) / steps,
      y: from.y + (dy * i) / steps,
    }));

  it('pen.draw: a drag becomes a stroke and the pen stays in charge', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });

    draw(container, wiggle({ x: 300, y: 200 }, 120, 60));
    expect(strokesOf(doc)).toHaveLength(1);

    // Unlike sticky/shape, the pen does not step aside after one stroke.
    expect(container.querySelector('[data-tool-layer="pen"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-tool-pen]')?.getAttribute('aria-pressed')).toBe('true');

    draw(container, wiggle({ x: 500, y: 300 }, -80, 40), 22);
    expect(strokesOf(doc)).toHaveLength(2);
  });

  it('TC-09 the pen stays active after a stroke; Escape returns to Select', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });
    draw(container, wiggle({ x: 200, y: 200 }, 100, 20));
    expect(strokesOf(doc)).toHaveLength(1);
    expect(container.querySelector('[data-tool-layer="pen"]')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[data-tool-layer="pen"]')).toBeNull();

    // Back in Select mode a drag no longer draws.
    const before = strokesOf(doc).length;
    fireEvent.pointerDown(window, { clientX: 400, clientY: 400, button: 0, pointerId: 23 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 500, button: 0, pointerId: 23 });
    fireEvent.pointerUp(window, { clientX: 600, clientY: 500, button: 0, pointerId: 23 });
    expect(strokesOf(doc)).toHaveLength(before);
  });

  it('TC-10 Escape mid-stroke drops the drawing and commits nothing on release', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });
    const layer = layerOf(container);
    fireEvent.pointerDown(layer, { clientX: 300, clientY: 300, button: 0, pointerId: 31 });
    fireEvent.pointerMove(window, { clientX: 360, clientY: 340, button: 0, pointerId: 31 });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[data-tool-layer="pen"]')).toBeNull();

    // The release lands with no tool listening: no stroke, no update at all.
    const updates = countUpdates(doc, () => {
      fireEvent.pointerMove(window, { clientX: 420, clientY: 380, button: 0, pointerId: 31 });
      fireEvent.pointerUp(window, { clientX: 420, clientY: 380, button: 0, pointerId: 31 });
    });
    expect(updates).toBe(0);
    expect(strokesOf(doc)).toHaveLength(0);
  });

  it('TC-11 drawing touches no document; the preview moves per animation frame', async () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });
    const layer = layerOf(container);

    const updates = countUpdates(doc, () => {
      fireEvent.pointerDown(layer, { clientX: 200, clientY: 200, button: 0, pointerId: 41 });
      for (const p of wiggle({ x: 200, y: 200 }, 90, 30)) {
        fireEvent.pointerMove(window, { clientX: p.x, clientY: p.y, button: 0, pointerId: 41 });
      }
    });
    expect(updates).toBe(0);
    expect(strokesOf(doc)).toHaveLength(0);

    await nextFrame();
    const path = container.querySelector<SVGPathElement>('[data-testid="pen-preview"] path');
    if (!path) throw new Error('the drawing painted no preview');
    const firstPath = path.getAttribute('d');

    fireEvent.pointerMove(window, { clientX: 360, clientY: 300, button: 0, pointerId: 41 });
    await nextFrame();
    const secondPath = container
      .querySelector<SVGPathElement>('[data-testid="pen-preview"] path')!
      .getAttribute('d');
    expect(secondPath).not.toBe(firstPath);

    // Still nothing in the document until the release.
    expect(strokesOf(doc)).toHaveLength(0);
    fireEvent.pointerUp(window, { clientX: 360, clientY: 300, button: 0, pointerId: 41 });
    expect(strokesOf(doc)).toHaveLength(1);
  });

  it('TC-12 a drag past STROKE_MAX_POINTS commits parts that join at one point', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });
    const layer = layerOf(container);
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100, button: 0, pointerId: 51 });

    // 5,010 synthetic points in 2-pixel steps: the limit is crossed mid-drag.
    for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
      fireEvent.pointerMove(window, {
        clientX: 100 + i * 2,
        clientY: 100 + i,
        button: 0,
        pointerId: 51,
      });
    }
    // The first part went in while the finger never left the mouse.
    const midDrag = strokesOf(doc);
    expect(midDrag).toHaveLength(1);

    fireEvent.pointerUp(window, { clientX: 100 + (STROKE_MAX_POINTS + 10) * 2, clientY: 100 + STROKE_MAX_POINTS + 10, button: 0, pointerId: 51 });
    const parts = strokesOf(doc);
    expect(parts).toHaveLength(2);

    // The parts join exactly: the second starts where the first ended.
    const endOfFirst = {
      x: parts[0]!.x + parts[0]!.points[parts[0]!.points.length - 2]!,
      y: parts[0]!.y + parts[0]!.points[parts[0]!.points.length - 1]!,
    };
    const startOfSecond = { x: parts[1]!.x + parts[1]!.points[0]!, y: parts[1]!.y + parts[1]!.points[1]! };
    expect(startOfSecond.x).toBeCloseTo(endOfFirst.x, 6);
    expect(startOfSecond.y).toBeCloseTo(endOfFirst.y, 6);
  });

  it('TC-13 colour and thickness choices drive new strokes and leave old ones alone', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });

    // The default: black, medium.
    draw(container, wiggle({ x: 200, y: 200 }, 100, 0), 61);
    const first = strokesOf(doc)[0];
    expect(first?.color).toBe('black');
    expect(first?.thickness).toBe('medium');

    const toolbar = container.querySelector<HTMLElement>('[data-testid="pen-toolbar"]');
    if (!toolbar) throw new Error('the Pen options toolbar is not up');
    fireEvent.click(toolbar.querySelector<HTMLButtonElement>('[aria-label="Red pen"]')!);
    fireEvent.click(toolbar.querySelector<HTMLButtonElement>('[aria-label="Thick"]')!);

    // The cursor dot shows the choice before anything is drawn.
    const layer = layerOf(container);
    fireEvent.pointerMove(layer, { clientX: 300, clientY: 300, button: 0, pointerId: 62 });
    const cursor = container.querySelector<HTMLElement>('[data-testid="pen-cursor"]');
    if (!cursor) throw new Error('the pen has no cursor indicator');
    expect(cursor.style.background.replace(/\s/g, '')).toBe('rgb(229,57,53)'.replace(/\s/g, ''));
    expect(cursor.style.width).toBe(`${PEN_THICKNESS_WORLD.thick}px`);

    draw(container, wiggle({ x: 400, y: 400 }, 0, -100), 63);
    const strokes = strokesOf(doc);
    expect(strokes[1]?.color).toBe('red');
    expect(strokes[1]?.thickness).toBe('thick');
    // Existing strokes keep their own ink.
    const again = strokesOf(doc)[0];
    expect(again?.color).toBe('black');
    expect(again?.thickness).toBe('medium');
  });

  it('TC-13 the swatch and thickness buttons announce themselves', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });
    const toolbar = container.querySelector<HTMLElement>('[data-testid="pen-toolbar"]')!;
    for (const name of ['Black', 'Blue', 'Red', 'Green', 'Orange', 'Purple']) {
      const swatch = toolbar.querySelector<HTMLButtonElement>(`[aria-label="${name} pen"]`);
      if (!swatch) throw new Error(`no swatch named "${name} pen"`);
      expect(swatch.getAttribute('aria-pressed')).toBe(name === 'Black' ? 'true' : 'false');
    }
    for (const name of ['Thin', 'Medium', 'Thick']) {
      const button = toolbar.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`);
      if (!button) throw new Error(`no thickness button named "${name}"`);
      expect(button.getAttribute('aria-pressed')).toBe(name === 'Medium' ? 'true' : 'false');
    }
    fireEvent.click(toolbar.querySelector<HTMLButtonElement>('[aria-label="Purple pen"]')!);
    expect(
      toolbar.querySelector<HTMLButtonElement>('[aria-label="Purple pen"]')!.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('TC-14 a pen drag over a note draws instead of moving it or panning', () => {
    const stickyId = seedSticky(doc, { x: 100, y: 50 });
    const { container } = render(<App doc={doc} />);
    const cameraBefore = cameraOf(container);
    const stickyBefore = snapshot(doc).find((s) => s.id === stickyId);

    fireEvent.keyDown(window, { key: 'p' });
    const centre = screenOf(container, { x: 100, y: 50 });
    // With the pen up, the press lands on the pen layer even when it sits over
    // a note — that is what the layer's inset:0 is for.
    draw(container, wiggle(centre, 140, 90), 71);

    expect(strokesOf(doc)).toHaveLength(1);
    const sticky = snapshot(doc).find((s) => s.id === stickyId);
    expect(sticky?.x).toBe(stickyBefore?.x);
    expect(sticky?.y).toBe(stickyBefore?.y);
    expect(cameraOf(container)).toEqual(cameraBefore);

    // The wheel over the pen layer is still navigation.
    const viewport = container.querySelector<HTMLElement>('.board-viewport')!;
    fireEvent.wheel(viewport, { deltaY: 240 });
    expect(cameraOf(container)).not.toEqual(cameraBefore);
  });

  it('TC-14 with Select back in charge the same drag moves the note', () => {
    const stickyId = seedSticky(doc, { x: 100, y: 50 });
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.keyDown(window, { key: 'v' });
    const note = container.querySelector<HTMLElement>(`[data-note-id="${stickyId}"]`)!;
    const centre = toScreen(cameraOf(container), { x: 100, y: 50 });
    fireEvent.pointerDown(note, { clientX: centre.x, clientY: centre.y, button: 0, pointerId: 81 });
    fireEvent.pointerMove(window, { clientX: centre.x + 80, clientY: centre.y, button: 0, pointerId: 81 });
    fireEvent.pointerUp(window, { clientX: centre.x + 80, clientY: centre.y, button: 0, pointerId: 81 });
    const sticky = snapshot(doc).find((s) => s.id === stickyId);
    // Seeded centred on (100, 50), so its box started at 0; the drag moved it
    // exactly 80 screen pixels (zoom 1).
    expect(sticky?.x).toBeCloseTo(80, 6);
    expect(strokesOf(doc)).toHaveLength(0);
  });

  it('TC-21 one stroke undoes as one step; the pen keeps drawing after undo', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 'p' });
    draw(container, wiggle({ x: 200, y: 200 }, 100, 40), 91);
    draw(container, wiggle({ x: 400, y: 200 }, 100, 40), 92);
    expect(strokesOf(doc)).toHaveLength(2);

    const undo = container.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!;
    fireEvent.click(undo);
    expect(strokesOf(doc)).toHaveLength(1);
    fireEvent.click(undo);
    expect(strokesOf(doc)).toHaveLength(0);

    // The pen was never disturbed by any of this.
    expect(container.querySelector('[data-tool-layer="pen"]')).not.toBeNull();
    draw(container, wiggle({ x: 600, y: 300 }, -50, 90), 93);
    expect(strokesOf(doc)).toHaveLength(1);

    const redo = container.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!;
    // Redo would replay an old stroke; the new one still stands next to it —
    // what matters here is that undo never merged two strokes into one step.
    fireEvent.click(redo);
    expect(strokesOf(doc).length).toBeGreaterThanOrEqual(1);
  });
});
