/**
 * The pieces the pen component tests share: a way to make a pointer event that
 * the board's listeners accept, a way to draw a path with it, and a way to read
 * back what the board ended up with. Kept out of the spec files because the pen
 * tool and the stroke object are tested in two files and draw the same shapes.
 */
import { act } from '@testing-library/react';
import { snapshot } from '../../src/shared/board-model';
import { flush, type AppHarness } from './appHarness';
import { dispatch } from './harness';

export const strokes = (harness: AppHarness) =>
  snapshot(harness.doc).filter((entry) => entry.type === 'stroke');

export const strokeElements = (harness: AppHarness) =>
  Array.from(
    harness.container.querySelectorAll<HTMLElement>('[data-testid^="stroke-"]'),
  );

export function pointer(type: string, x: number, y: number, buttons: number): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'buttons', { value: buttons });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

export function key(name: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
}

/** Turn the pen on, the way the toolbar and the keyboard do it. */
export async function penOn(harness: AppHarness): Promise<void> {
  await dispatch(window, key('p'));
  await flush();
}

export interface DrawOptions {
  /** Send this key between the first and second move. */
  escapeMidway?: boolean;
  /** Send this letter between the first and second move. */
  switchMidway?: string;
  /** Lift the pen without drawing (a tap). */
  tapOnly?: boolean;
}

/**
 * One gesture: a press at `points[0]`, a move for every point after it, and a
 * lift. The moves go on the window, which is where the running app puts them.
 */
export async function draw(
  harness: AppHarness,
  points: readonly { x: number; y: number }[],
  options: DrawOptions = {},
): Promise<void> {
  const surface = harness.board();
  await dispatch(surface, pointer('pointerdown', points[0]!.x, points[0]!.y, 1));
  const moves = options.tapOnly ? points.slice(1) : points.slice(1);
  for (const [index, point] of moves.entries()) {
    await dispatch(window, pointer('pointermove', point.x, point.y, 1));
    if (index === 0 && options.escapeMidway) {
      await dispatch(window, key('Escape'));
      break;
    }
    if (index === 0 && options.switchMidway) {
      await dispatch(window, key(options.switchMidway));
      break;
    }
  }
  const last = points[points.length - 1]!;
  await dispatch(window, pointer('pointerup', last.x, last.y, 0));
  await flush();
}

/**
 * The same gesture without a React `act` round trip per event. A six-thousand
 * point path is the interesting case, and flushing after every sample makes it
 * slow for a reason that has nothing to do with what is being tested.
 */
export async function drawFast(
  harness: AppHarness,
  points: readonly { x: number; y: number }[],
): Promise<void> {
  await act(async () => {
    const surface = harness.board();
    surface.dispatchEvent(pointer('pointerdown', points[0]!.x, points[0]!.y, 1));
    for (const point of points.slice(1)) {
      window.dispatchEvent(pointer('pointermove', point.x, point.y, 1));
    }
    const last = points[points.length - 1]!;
    window.dispatchEvent(pointer('pointerup', last.x, last.y, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  });
  await flush();
}

/**
 * What the board has selected, read off the selection frame: one outline per
 * selected object, tagged with its id.
 */
export const selectedIds = (harness: AppHarness) =>
  Array.from(
    harness.container.querySelectorAll<HTMLElement>(
      '[data-testid="local-selection-outline"]',
    ),
  ).map((element) => element.getAttribute('data-outline-id'));

/** A press and a lift on the board, which is how a click reaches the surface. */
export async function clickAt(harness: AppHarness, x: number, y: number): Promise<void> {
  const surface = harness.board();
  await dispatch(surface, pointer('pointerdown', x, y, 1));
  await dispatch(surface, pointer('pointerup', x, y, 0));
  await flush();
}

/** Leave the pen, and leave whatever the last gesture left selected. */
export async function handsOff(harness: AppHarness): Promise<void> {
  await dispatch(window, key('v'));
  await flush();
  await dispatch(window, key('Escape'));
  await flush();
}

/** A hand-drawn circle around `(cx, cy)`, closing where it started. */
export function circle(
  cx: number,
  cy: number,
  radius: number,
  turns = 1,
  samples = 80,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const angle = (i / samples) * Math.PI * 2 * turns;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

/**
 * Three turns that tighten as they go, so the pen ends in the middle of what it
 * drew: the box is round, the two ends are nowhere near each other, and only a
 * rule about the ends can tell this from a circle.
 */
export function spiral(
  cx: number,
  cy: number,
  radius: number,
  turns = 3,
  samples = 240,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const step = i / samples;
    const angle = step * Math.PI * 2 * turns;
    const reach = radius * (1 - step * 0.8);
    points.push({ x: cx + Math.cos(angle) * reach, y: cy + Math.sin(angle) * reach });
  }
  return points;
}

