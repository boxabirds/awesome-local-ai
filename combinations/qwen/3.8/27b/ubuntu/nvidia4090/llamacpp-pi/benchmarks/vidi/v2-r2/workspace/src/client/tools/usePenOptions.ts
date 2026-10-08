/**
 * Pen options (story 11, pen.options): the colour and thickness the Pen
 * tool draws with, held in plain session React state (defaults
 * DEFAULT_PEN_COLOR / DEFAULT_PEN_THICKNESS).
 *
 * The choices are never written to the document and never persisted: they
 * last until the page is reloaded (pen.options), and they only affect
 * LATER strokes — existing strokes keep their stored colour and thickness
 * (they are data, not styles).
 */
import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptions {
  /** The colour the next stroke uses. */
  color: PenColor;
  /** The thickness the next stroke uses. */
  thickness: PenThickness;
  /** Chooses the colour for later strokes (unknown names are ignored). */
  setColor(c: PenColor): void;
  /** Chooses the thickness for later strokes (unknown names are ignored). */
  setThickness(t: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((c: PenColor): void => {
    if (typeof c === 'string' && c in PEN_COLORS) {
      setColorState(c);
    }
  }, []);

  const setThickness = useCallback((t: PenThickness): void => {
    if (typeof t === 'string' && t in PEN_THICKNESS_WORLD) {
      setThicknessState(t);
    }
  }, []);

  return { color, thickness, setColor, setThickness };
}
