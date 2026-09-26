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
 * The pen's colour and thickness (story 11).
 *
 * Session state, nothing more: the options belong to the person holding the
 * pen, they are the same for everybody who joins later, and they are not worth
 * a round trip. Nothing here is written to the document or to storage, so a
 * reload starts back at black and medium (pen.options).
 */
export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  // Guarded rather than trusting the caller: an unknown name would reach the
  // document and be repaired on the next read, which is a pointless round trip.
  const setColor = useCallback((next: PenColor) => {
    if (!(next in PEN_COLORS)) return;
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    if (!(next in PEN_THICKNESS_WORLD)) return;
    setThicknessState(next);
  }, []);

  return { color, thickness, setColor, setThickness };
}