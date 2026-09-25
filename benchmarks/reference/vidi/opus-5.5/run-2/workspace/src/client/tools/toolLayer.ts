/** Shared helpers of the creation tool layers (stories 10–12). */
import type { PointerEvent } from 'react';
import type { Point } from '../canvas/camera';

export const PRIMARY_BUTTON = 0;

/** Pointer position relative to the layer, which covers the board viewport exactly. */
export function layerPoint(e: PointerEvent<Element>): Point {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
