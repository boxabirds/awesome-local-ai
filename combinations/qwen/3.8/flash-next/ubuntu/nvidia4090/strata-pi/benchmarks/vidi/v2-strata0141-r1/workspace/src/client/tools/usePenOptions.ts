import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/**
 * What the pen is set to (anchor `pen.options`).
 *
 * Session state and nothing else: React state in the board that holds the tool,
 * never written to the document, never stored in a preference. The choice applies
 * to the *next* stroke and to every stroke after it until the page is reloaded;
 * the colour and thickness of a stroke that already exists live in that stroke, so
 * changing the pen never restyles it (`pen.options`, TC-14).
 *
 * Both setters validate the name they are given against the same tables the model
 * validates against, so a name that `createStroke` would refuse can never be held
 * here either.
 */
export interface PenOptions {
  readonly color: PenColor;
  readonly thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor): void => {
    if (Object.prototype.hasOwnProperty.call(PEN_COLORS, next)) {
      setColorState(next);
    }
  }, []);

  const setThickness = useCallback((next: PenThickness): void => {
    if (Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, next)) {
      setThicknessState(next);
    }
  }, []);

  return { color, thickness, setColor, setThickness };
}
