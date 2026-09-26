import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, cleanup } from '@testing-library/react';
import { renderFullApp, hooks, firePointer, fireWindowPointer, pressKey } from './story2';
import { createStroke } from '@/shared/objects/stroke';
import { PEN_THICKNESS_WORLD } from '@/shared/config';

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

// Spy on createStroke (the real implementation runs against the real doc) so
// the tests can assert HOW the Pen tool commits (points, colour, thickness).
vi.mock('@/shared/objects/stroke', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/shared/objects/stroke')>();
  return { ...real, createStroke: vi.fn(real.createStroke) };
});

const createStrokeSpy = vi.mocked(createStroke);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  createStrokeSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  createStrokeSpy.mockClear();
});

function penButton(): HTMLButtonElement {
  return screen.getByTestId('pen-tool-button') as HTMLButtonElement;
}
function selectButton(): HTMLButtonElement {
  return screen.getByTestId('select-tool-button') as HTMLButtonElement;
}

/** jsdom window is 1024x768; initial camera (-512,-384), zoom 1. */
const S = (wx: number, wy: number): { x: number; y: number } => ({ x: wx + 512, y: wy + 384 });

function strokes() {
  return hooks().getObjects().filter((o) => o.type === 'stroke');
}

/**
 * Draws a stroke with the pen: pointerdown on the viewport (the press),
 * pointermove/up on the window (the Pen tool's window listeners own the rest
 * of the gesture, exactly as in the browser).
 */
function drawStroke(pts: Array<{ x: number; y: number }>): void {
  const [first, ...rest] = pts;
  firePointer(screen.getByTestId('board-viewport'), 'pointerdown', first.x, first.y);
  for (const p of rest) {
    fireWindowPointer('pointermove', p.x, p.y);
  }
  const last = rest.length > 0 ? rest[rest.length - 1] : first;
  fireWindowPointer('pointerup', last.x, last.y);
}

describe('story 11: pen tool (ui-component)', () => {
  it('TC-09: p activates the pen; a drag commits one stroke with the chosen options; the pen stays active', async () => {
    await renderFullApp();
    pressKey(window, 'p');
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');

    // Choose red + thick in the pen options toolbar.
    act(() => {
      (screen.getByTestId('pen-color-red') as HTMLButtonElement).click();
    });
    act(() => {
      (screen.getByTestId('pen-thickness-thick') as HTMLButtonElement).click();
    });

    // Drag three points (world (-100,-100) -> (-50,-100) -> (-50,-50)).
    drawStroke([S(-100, -100), S(-50, -100), S(-50, -50)]);

    expect(createStrokeSpy).toHaveBeenCalledTimes(1);
    const [doc, arg, by] = createStrokeSpy.mock.calls[0];
    expect(doc).toBe(hooks().getDoc());
    expect(typeof by).toBe('string');
    expect(arg.color).toBe('red');
    expect(arg.thickness).toBe('thick');
    expect(arg.points).toHaveLength(3);

    // The stroke is on the board and the pen is STILL active (pen.active).
    const list = strokes();
    expect(list).toHaveLength(1);
    expect(list[0].color).toBe('red');
    expect(list[0].thickness).toBe('thick');
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-10: pointerdown/up without movement commits a single-point round dot', async () => {
    await renderFullApp();
    pressKey(window, 'p');

    const at = S(0, 0);
    firePointer(screen.getByTestId('board-viewport'), 'pointerdown', at.x, at.y);
    fireWindowPointer('pointerup', at.x, at.y);

    expect(createStrokeSpy).toHaveBeenCalledTimes(1);
    expect(createStrokeSpy.mock.calls[0][1].points).toHaveLength(1);
    const list = strokes();
    expect(list).toHaveLength(1);
    // A dot is a thickness x thickness square (default medium = 4).
    expect(list[0].width).toBe(PEN_THICKNESS_WORLD.medium);
    expect(list[0].height).toBe(PEN_THICKNESS_WORLD.medium);
  });

  it('TC-11: a cancelled drag (pointercancel) commits the points drawn so far', async () => {
    await renderFullApp();
    pressKey(window, 'p');

    firePointer(screen.getByTestId('board-viewport'), 'pointerdown', S(10, 10).x, S(10, 10).y);
    fireWindowPointer('pointermove', S(30, 20).x, S(30, 20).y);
    fireWindowPointer('pointercancel', S(30, 20).x, S(30, 20).y);

    expect(createStrokeSpy).toHaveBeenCalledTimes(1);
    expect(createStrokeSpy.mock.calls[0][1].points).toHaveLength(2);
    expect(strokes()).toHaveLength(1);
    // A further gesture starts a fresh stroke.
    drawStroke([S(-50, 50), S(-20, 60)]);
    expect(createStrokeSpy).toHaveBeenCalledTimes(2);
  });

  it('TC-12: 5000+10 points commit as two strokes that join at the shared point', async () => {
    // The preview redraw is rAF-driven; it is irrelevant here, so neutralise
    // rAF to keep the run deterministic and fast.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});

    await renderFullApp();
    pressKey(window, 'p');

    const vp = screen.getByTestId('board-viewport');
    firePointer(vp, 'pointerdown', 200, 300);
    // 5010 moves: 5000+10 raw points including the down point.
    for (let i = 1; i <= 5010; i += 1) {
      fireWindowPointer('pointermove', 200 + (i % 50), 300 + Math.floor(i / 50));
    }
    fireWindowPointer('pointerup', 200 + (5010 % 50), 300 + Math.floor(5010 / 50));

    expect(createStrokeSpy).toHaveBeenCalledTimes(2);
    const first = createStrokeSpy.mock.calls[0][1].points;
    const second = createStrokeSpy.mock.calls[1][1].points;
    // Both parts are non-trivial (the gesture really did split mid-stroke;
    // without the split there would be a single commit on release).
    expect(first.length).toBeGreaterThan(1);
    expect(second.length).toBeGreaterThan(1);
    // The second stroke starts at the first stroke's last point (no gap);
    // RDP keeps both endpoints, so the shared join point survives.
    expect(second[0]).toEqual(first[first.length - 1]);
    // The gesture's start and end survive simplification.
    expect(first[0]).toEqual({ x: 200 - 512, y: 300 - 384 });
    expect(second[second.length - 1]).toEqual({
      x: 200 + (5010 % 50) - 512,
      y: 300 + Math.floor(5010 / 50) - 384,
    });
    expect(strokes()).toHaveLength(2);
  });

  it('TC-13: Escape switches to Select; P again, then V; no stroke is created', async () => {
    await renderFullApp();
    pressKey(window, 'p');
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');

    pressKey(window, 'Escape');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(penButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();

    pressKey(window, 'p');
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    pressKey(window, 'v');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');

    expect(createStrokeSpy).not.toHaveBeenCalled();
    expect(hooks().getObjects()).toHaveLength(0);
  });

  it('TC-14: changing the colour after a stroke leaves it unchanged; the next stroke uses it', async () => {
    await renderFullApp();
    pressKey(window, 'p');

    // First stroke: defaults (black, medium).
    drawStroke([S(-150, -150), S(-100, -140), S(-90, -100)]);
    expect(strokes()).toHaveLength(1);

    act(() => {
      (screen.getByTestId('pen-color-red') as HTMLButtonElement).click();
    });
    expect(screen.getByTestId('pen-color-red')).toHaveAttribute('aria-pressed', 'true');

    // Second stroke: red.
    drawStroke([S(50, 50), S(100, 40), S(110, 80)]);
    const list = strokes();
    expect(list).toHaveLength(2);
    expect(list[0].color).toBe('black');
    expect(list[1].color).toBe('red');
    // Thickness stayed at the default.
    expect(list[1].thickness).toBe('medium');
  });
});
