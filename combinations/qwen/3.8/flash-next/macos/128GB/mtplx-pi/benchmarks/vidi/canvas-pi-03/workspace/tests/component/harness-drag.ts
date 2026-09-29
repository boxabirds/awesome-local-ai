import { act } from '@testing-library/react';
import { pointerEventEx, fire } from './harness';

/**
 * Drag helpers for the story-7 transform tests.
 *
 * jsdom has no pointer capture, so a real drag would retarget its moves to the
 * viewport. The components under test capture the pointer on the element they
 * were pressed on, so the moves are dispatched on THAT element — which is what
 * a browser does while the capture is held.
 */

/** Move the pointer in `steps` hops from (sx,sy) to (sx+dx, sy+dy), then release. */
export function dragOn(
  start: HTMLElement | Document | Window,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  opts: { steps?: number; shift?: boolean; cancel?: boolean } = {},
): void {
  const steps = opts.steps ?? 4;
  fire(start, pointerEventEx('pointerdown', sx, sy, { shift: opts.shift }));
  for (let i = 1; i <= steps; i += 1) {
    const x = sx + (dx * i) / steps;
    const y = sy + (dy * i) / steps;
    fire(start, pointerEventEx('pointermove', x, y, { shift: opts.shift }));
  }
  const end = opts.cancel ? 'pointercancel' : 'pointerup';
  fire(start, pointerEventEx(end, sx + dx, sy + dy, { shift: opts.shift }));
}

/** Read positions of a list of ids out of the board snapshot. */
export function positions(
  snapshot: Array<{ id: string; x: number; y: number; width?: number; height?: number }>,
  ids: readonly string[],
): Record<string, { x: number; y: number; width?: number; height?: number }> {
  const out: Record<string, { x: number; y: number; width?: number; height?: number }> = {};
  for (const id of ids) {
    const found = snapshot.find((n) => n.id === id);
    if (found) out[id] = { x: found.x, y: found.y, width: found.width, height: found.height };
  }
  return out;
}

/** Run `fn` inside React's act() so any state it triggers is flushed. */
export function run(fn: () => void): void {
  act(() => {
    fn();
  });
}
