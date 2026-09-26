import { useCallback, useState } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
} from '@/shared/config';
import type { PenColor, PenThickness } from '@/shared/objects/stroke';

/**
 * Pen options (story 11, pen.options): the current colour swatch and line
 * thickness. Session state only — nothing is written to the doc (the options
 * belong to the tool, not to the board). The toolbar renders it; the Pen tool
 * reads it when committing a stroke.
 */
export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor: (c: PenColor) => void;
  setThickness: (t: PenThickness) => void;
} {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return { color, thickness, setColor: useCallback(setColor, []), setThickness: useCallback(setThickness, []) };
}

export type PenOptions = ReturnType<typeof usePenOptions>;

/** All swatches with their names and CSS colours (toolbar order). */
export const PEN_SWATCHES: ReadonlyArray<{ name: PenColor; color: string }> = (
  Object.keys(PEN_COLORS) as PenColor[]
).map((name) => ({ name, color: PEN_COLORS[name] }));

/** All thickness presets with their names and world-unit widths. */
export const PEN_THICKNESSES: ReadonlyArray<{ name: PenThickness; width: number }> = (
  Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]
).map((name) => ({ name, width: PEN_THICKNESS_WORLD[name] }));
