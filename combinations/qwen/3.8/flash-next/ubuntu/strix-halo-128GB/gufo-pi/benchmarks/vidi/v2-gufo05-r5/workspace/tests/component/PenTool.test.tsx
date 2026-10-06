/**
 * The Pen tool (story 11), TC-09 to TC-14.
 *
 * Everything here is driven through the real board: the P key, the pen's own surface, its own bar, and
 * the document that comes out the other end. The board sits at the world origin at zoom 1, so a screen
 * coordinate and a world coordinate are the same numbers and a test can say what the stroke it expects
 * looks like without converting anything.
 *
 * What the tests hold the tool to, in order: a drag writes exactly one stroke in the colour and
 * thickness the bar was left on (TC-09); a press that goes nowhere is a dot (TC-10); a gesture that is
 * taken away mid-drag keeps what it had drawn (TC-11); a drag that runs past the point limit becomes two
 * strokes that join where the first stopped (TC-12); Escape puts the pen down without drawing (TC-13);
 * and the bar changes the *next* stroke only, never one already on the board (TC-14). Between the first
 * sample and the last, the stroke is not in the document at all - which is the whole of "nobody sees a
 * half-drawn line".
 */
import { act, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test, vi } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, dispatchKey, dispatchWheel, getCamera, runFrames } from './helpers';
import {
  createSticky,
  isStrokeSnapshot,
  type StrokeSnapshot,
} from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { PenColor, PenThickness } from '../../src/shared/objects/stroke';
import { HANDWRITTEN_LOOP, LONG_SPIRAL } from '../fixtures/pen-paths';

vi.useFakeTimers();

const pointer = (clientX: number, clientY: number, opts?: Record<string, unknown>) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function strokes(): readonly StrokeSnapshot[] {
  return (window.__vidi6?.getObjects() ?? []).filter(isStrokeSnapshot);
}

function penSurface(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="pen-tool-surface"]');
  if (!el) throw new Error('the Pen is not up');
  return el;
}

function penSurfaceOrNone(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="pen-tool-surface"]');
}

function previewPathOrNone(): SVGPathElement | null {
  return document.querySelector<SVGPathElement>('[data-testid="pen-preview-path"]');
}

function toolbarOrNone(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="pen-toolbar"]');
}

/** Puts the camera where the tests read the board from: the origin, at 1:1. */
async function originCamera(): Promise<void> {
  window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 1 });
  await runFrames();
  await runFrames();
}

async function openBoard(): Promise<void> {
  renderBoard();
  await runFrames();
  await originCamera();
}

async function startPen(): Promise<void> {
  dispatchKey(window, { key: 'p' });
  await runFrames();
}

function chooseColor(color: PenColor): void {
  fireEvent.click(screen.getByRole('button', { name: `${color} pen` }));
}

function chooseThickness(thickness: PenThickness): void {
  const label = thickness.charAt(0).toUpperCase() + thickness.slice(1);
  fireEvent.click(screen.getByRole('button', { name: label }));
}

/**
 * Compares a box edge with slack: smoothing a stroke is allowed to move the ink up to the simplify
 * tolerance (`pen.smooth` says never further than the eye can tell), so a stored box can sit at most
 * a tolerance away from the extreme of what was dragged.
 */
function near(actual: number, expected: number, slack = 1.5): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(slack);
}

/** Presses, drags through every point and releases. Frames are run only when a test needs them. */
function firePath(points: readonly { x: number; y: number }[]): void {
  const surface = penSurface();
  fireEvent.pointerDown(surface, pointer(points[0]!.x, points[0]!.y));
  for (let i = 1; i < points.length; i += 1) {
    fireEvent.pointerMove(surface, pointer(points[i]!.x, points[i]!.y));
  }
}

async function draw(points: readonly { x: number; y: number }[]): Promise<void> {
  firePath(points);
  const last = points[points.length - 1]!;
  fireEvent.pointerUp(penSurface(), pointer(last.x, last.y));
  await runFrames();
}

describe('the Pen draws one stroke at a time (TC-09, TC-10)', () => {
  test('TC-09 a drag with red and Thick chosen writes one red, thick stroke - and the Pen stays armed', async () => {
    await openBoard();
    await startPen();

    // P puts the pen up: its surface over the board, its bar beside the toolbar, the button pressed
    expect(penSurface()).toBeTruthy();
    expect(toolbarOrNone()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    chooseColor('red');
    chooseThickness('thick');

    const surface = penSurface();
    fireEvent.pointerDown(surface, pointer(200, 200));
    fireEvent.pointerMove(surface, pointer(260, 230));
    await runFrames();

    // the line follows the pointer as a preview, and it is not on the board yet: nobody else is
    // watching a half-drawn stroke (`pen.share`)
    const preview = previewPathOrNone();
    expect(preview).not.toBeNull();
    expect(preview!.getAttribute('d')?.startsWith('M ')).toBe(true);
    expect(strokes().length).toBe(0);

    fireEvent.pointerMove(surface, pointer(320, 210));
    fireEvent.pointerUp(surface, pointer(320, 210));
    await runFrames();

    const drawn = strokes();
    expect(drawn.length).toBe(1);
    expect(drawn[0]!.color).toBe('red');
    expect(drawn[0]!.thickness).toBe('thick');
    // the ink runs from where the pointer went down to where it came up, the box padded by the nib
    const half = PEN_THICKNESS_WORLD.thick / 2;
    expect(drawn[0]).toMatchObject({
      x: 200 - half,
      y: 200 - half,
      width: 120 + half * 2,
      height: 30 + half * 2,
    });
    // and it is on the board as an object, so the preview is gone
    expect(document.querySelector('[data-testid="stroke-object"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="pen-preview"]')).toBeNull();

    // one finished stroke is one undo step
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await runFrames();
    expect(strokes().length).toBe(0);

    // the Pen is still armed: another stroke can start without touching the toolbar again
    expect(penSurfaceOrNone()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-09 a sketch of a loop comes out as one stroke that goes where the hand went', async () => {
    await openBoard();
    await startPen();
    // the fixture is centred near the origin; nudge it into positive screen space
    const path = HANDWRITTEN_LOOP.map((p) => ({ x: p.x + 500, y: p.y + 400 }));
    await draw(path);

    const drawn = strokes();
    expect(drawn.length).toBe(1);
    const stored = drawn[0]!;
    expect(stored.points.length / 2).toBeLessThan(path.length);
    // the box holds everything that was drawn, to within the smoothing tolerance
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    near(stored.x, Math.min(...xs) - half);
    near(stored.y, Math.min(...ys) - half);
    near(stored.x + stored.width, Math.max(...xs) + half);
    near(stored.y + stored.height, Math.max(...ys) + half);
  });

  test('TC-10 a press and release that never moves is one point, drawn as a dot of the chosen thickness', async () => {
    await openBoard();
    await startPen();
    chooseColor('blue');

    const surface = penSurface();
    fireEvent.pointerDown(surface, pointer(400, 300));
    fireEvent.pointerUp(surface, pointer(400, 300));
    await runFrames();

    const drawn = strokes();
    expect(drawn.length).toBe(1);
    const dot = drawn[0]!;
    const size = PEN_THICKNESS_WORLD.medium;
    expect(dot.points.length).toBe(2);
    expect(dot).toMatchObject({
      x: 400 - size / 2,
      y: 300 - size / 2,
      width: size,
      height: size,
      color: 'blue',
      thickness: 'medium',
    });
    // a dot is a stroke of one point: the path is zero-length, which a round cap renders as a dot
    const line = document.querySelector<SVGPathElement>('[data-testid="stroke-line"]');
    expect(line?.getAttribute('d')).toBe(`M 400 300 L 400 300`);
  });

  test('TC-10 a press that wobbles inside a pixel is still a dot and not a scribble', async () => {
    await openBoard();
    await startPen();
    await draw([
      { x: 300, y: 300 },
      { x: 300.6, y: 300.4 },
      { x: 300.2, y: 300.8 },
      { x: 300.5, y: 300.1 },
    ]);

    const drawn = strokes();
    expect(drawn.length).toBe(1);
    expect(drawn[0]!.points.length).toBe(2);
  });
});

describe('the Pen finishes what it has (TC-11, TC-12)', () => {
  test('TC-11 a drag taken away by pointercancel keeps the stroke drawn so far', async () => {
    await openBoard();
    await startPen();

    const surface = penSurface();
    fireEvent.pointerDown(surface, pointer(100, 100));
    fireEvent.pointerMove(surface, pointer(180, 140));
    fireEvent.pointerMove(surface, pointer(240, 120));
    await runFrames();
    expect(strokes().length).toBe(0);

    fireEvent.pointerCancel(surface, pointer(240, 120));
    await runFrames();

    const drawn = strokes();
    expect(drawn.length).toBe(1);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    expect(drawn[0]).toMatchObject({
      x: 100 - half,
      y: 100 - half,
      width: 140 + half * 2,
      height: 40 + half * 2,
    });
    // and the pen is still the pen, ready for the next stroke
    expect(penSurfaceOrNone()).not.toBeNull();
  });

  test('TC-11 losing the pointer the same way finishes the stroke too', async () => {
    await openBoard();
    await startPen();

    const surface = penSurface();
    fireEvent.pointerDown(surface, pointer(120, 220));
    fireEvent.pointerMove(surface, pointer(200, 260));
    await runFrames();
    fireEvent.lostPointerCapture(surface, pointer(200, 260));
    await runFrames();

    expect(strokes().length).toBe(1);
  });

  test('TC-12 a drag of STROKE_MAX_POINTS + 10 becomes two strokes that join where the first stopped', async () => {
    await openBoard();
    await startPen();

    // A burst of 5,010 samples: the limit is crossed mid-drag, so the tool commits the first 5,000 and
    // carries on from the point it stopped at. Fired without a frame in between, which is the worst
    // case: the whole drag arrives faster than anything could be painted.
    firePath(LONG_SPIRAL);
    const last = LONG_SPIRAL[LONG_SPIRAL.length - 1]!;
    fireEvent.pointerUp(penSurface(), pointer(last.x, last.y));
    await runFrames();

    const drawn = strokes();
    expect(drawn.length).toBe(2);
    const [first, second] = drawn;
    // the first part is the whole of the limit, the second is what came after it
    expect(first!.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(second!.points.length / 2).toBeLessThan(STROKE_MAX_POINTS);

    // they join: the second stroke starts exactly where the first one ended, so the long line has no
    // gap in it and no visible seam
    const firstEnd = {
      x: first!.x + first!.points[first!.points.length - 2]!,
      y: first!.y + first!.points[first!.points.length - 1]!,
    };
    const secondStart = {
      x: second!.x + second!.points[0]!,
      y: second!.y + second!.points[1]!,
    };
    expect(secondStart.x).toBeCloseTo(firstEnd.x, 6);
    expect(secondStart.y).toBeCloseTo(firstEnd.y, 6);

    // the pair together cover the drag: nothing was dropped at the join
    const xs = LONG_SPIRAL.map((p) => p.x);
    const ys = LONG_SPIRAL.map((p) => p.y);
    const left = Math.min(first!.x, second!.x);
    const right = Math.max(first!.x + first!.width, second!.x + second!.width);
    const top = Math.min(first!.y, second!.y);
    const bottom = Math.max(first!.y + first!.height, second!.y + second!.height);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    near(left, Math.min(...xs) - half);
    near(right, Math.max(...xs) + half);
    near(top, Math.min(...ys) - half);
    near(bottom, Math.max(...ys) + half);
  }, 30_000);
});

describe('the Pen stays put, and its bar changes only what comes next (TC-13, TC-14)', () => {
  test('TC-13 Escape puts the Pen down without drawing, and V does too', async () => {
    await openBoard();
    await startPen();

    dispatchKey(window, { key: 'Escape' });
    await runFrames();
    expect(penSurfaceOrNone()).toBeNull();
    expect(toolbarOrNone()).toBeNull();
    expect(strokes().length).toBe(0);
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // back to the Pen, then straight to Select with the other tool's key: still nothing drawn
    await startPen();
    expect(penSurfaceOrNone()).not.toBeNull();
    dispatchKey(window, { key: 'v' });
    await runFrames();
    expect(penSurfaceOrNone()).toBeNull();
    expect(strokes().length).toBe(0);
  });

  test('TC-13 a stroke in mid-air is abandoned by Escape, not committed', async () => {
    await openBoard();
    await startPen();

    const surface = penSurface();
    fireEvent.pointerDown(surface, pointer(150, 150));
    fireEvent.pointerMove(surface, pointer(250, 250));
    await runFrames();
    expect(previewPathOrNone()).not.toBeNull();

    dispatchKey(window, { key: 'Escape' });
    await runFrames();
    expect(strokes().length).toBe(0);
    expect(previewPathOrNone()).toBeNull();
  });

  test('TC-14 changing the colour restyles the next stroke, never the one already drawn', async () => {
    await openBoard();
    await startPen();

    await draw([
      { x: 100, y: 420 },
      { x: 220, y: 460 },
    ]);
    const first = strokes()[0]!;
    expect(first.color).toBe('black');
    expect(first.thickness).toBe('medium');

    chooseColor('green');
    chooseThickness('thick');
    await draw([
      { x: 300, y: 420 },
      { x: 420, y: 460 },
    ]);

    const drawn = strokes();
    expect(drawn.length).toBe(2);
    const again = drawn.find((stroke) => stroke.id === first.id)!;
    // the stroke that is on the board keeps the colour and thickness it was drawn with, for ever
    expect(again.color).toBe('black');
    expect(again.thickness).toBe('medium');
    expect(document.querySelector(`[data-stroke-id="${first.id}"]`)).toHaveAttribute(
      'data-stroke-color',
      'black',
    );
    // the new one took what the bar says now
    const newest = drawn.find((stroke) => stroke.id !== first.id)!;
    expect(newest.color).toBe('green');
    expect(newest.thickness).toBe('thick');
  });

  test('the pen bar offers six colours and three thicknesses, and says which are chosen', async () => {
    await openBoard();
    expect(toolbarOrNone()).toBeNull();
    await startPen();

    for (const color of Object.keys(PEN_COLORS)) {
      expect(screen.getByRole('button', { name: `${color} pen` })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Thin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medium' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thick' })).toBeTruthy();

    // where the session started: black, medium
    expect(screen.getByRole('button', { name: 'black pen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');

    chooseColor('purple');
    chooseThickness('thin');
    expect(screen.getByRole('button', { name: 'purple pen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'black pen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Thin' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('navigation while the Pen is up (pen.navigation)', () => {
  test('a drag on the board pans nothing and draws nothing that the viewport could have made', async () => {
    await openBoard();
    const before = getCamera();

    // the Pen's surface covers the viewport, so a real drag can only ever reach the Pen
    await startPen();
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, pointer(400, 300));
    fireEvent.pointerMove(viewport, pointer(700, 500));
    await runFrames();
    fireEvent.pointerUp(viewport, pointer(700, 500));
    await runFrames();

    expect(getCamera()).toEqual(before);
    expect(strokes().length).toBe(0);
  });

  test('the wheel still pans, and Ctrl+wheel still zooms, with the Pen in the way', async () => {
    await openBoard();
    await startPen();

    dispatchWheel(penSurface(), { deltaY: 120, clientX: 500, clientY: 400 });
    await runFrames();
    const panned = getCamera();
    expect(panned.y).not.toBe(0);

    dispatchWheel(penSurface(), { deltaY: -240, ctrlKey: true, clientX: 500, clientY: 400 });
    await runFrames();
    expect(getCamera().zoom).not.toBe(1);
  });

  test('a Pen drag that starts on a sticky note draws over it and leaves the note alone', async () => {
    await openBoard();
    let noteId = '';
    await act(() => {
      noteId = createSticky(doc(), { x: 260, y: 260 });
    });
    await runFrames();
    const element = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
    expect(element).not.toBeNull();
    const style = { left: element!.style.left, top: element!.style.top };

    await startPen();
    await draw([
      { x: 280, y: 280 },
      { x: 340, y: 320 },
      { x: 400, y: 300 },
    ]);

    const after = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)!;
    expect({ left: after.style.left, top: after.style.top }).toEqual(style);
    expect(after).not.toHaveAttribute('data-selected', 'true');
    expect(strokes().length).toBe(1);
    // and the board did not move out from under the stroke either
    expect(getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('the round cursor', () => {
  test('the nib is the thickness of the pen at the zoom of the board', async () => {
    await openBoard();
    await startPen();

    const surface = penSurface();
    // pointerover is what React turns into a pointer enter; the nib follows the pointer from then on
    fireEvent.pointerOver(surface, pointer(300, 300));
    await runFrames();
    const nib = document.querySelector<HTMLElement>('[data-testid="pen-cursor"]');
    expect(nib).not.toBeNull();
    expect(nib!.style.width).toBe(`${PEN_THICKNESS_WORLD.medium * 1}px`);

    chooseThickness('thick');
    await runFrames();
    const grown = document.querySelector<HTMLElement>('[data-testid="pen-cursor"]')!;
    expect(grown.style.width).toBe(`${PEN_THICKNESS_WORLD.thick}px`);
    expect(grown.style.height).toBe(`${PEN_THICKNESS_WORLD.thick}px`);
  });
});
