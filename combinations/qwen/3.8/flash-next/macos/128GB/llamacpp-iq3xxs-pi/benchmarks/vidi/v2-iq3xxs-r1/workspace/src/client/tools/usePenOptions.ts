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
 * Which pen the next stroke is drawn with (story 11, PRD `pen.options`).
 *
 * Two pieces of React state, in the tab that owns them. They are not a board field:
 * nothing is synced, a colleague's pen never changes because of this one, and a page
 * reload brings the defaults back. Nothing else about the app changes — a note is
 * still a sticky, and the colour of the pen is decided when the stroke is created,
 * exactly like a shape's fill is decided when the shape is created.
 */
export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  /** An unknown name is ignored, so a stray key can never put the pen in an unknown state. */
  setColor(name: string): void;
  setThickness(name: string): void;
  /** The ink of the current pen, in board units (`PEN_THICKNESS_WORLD`). */
  inkWorld(): number;
}

export function isPenColor(name: string): name is PenColor {
  return name in PEN_COLORS;
}

export function isPenThickness(name: string): name is PenThickness {
  return name in PEN_THICKNESS_WORLD;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((name: string) => {
    if (isPenColor(name)) setColorState(name);
  }, []);
  const setThickness = useCallback((name: string) => {
    if (isPenThickness(name)) setThicknessState(name);
  }, []);
  return {
    color,
    thickness,
    setColor,
    setThickness,
    inkWorld: () => PEN_THICKNESS_WORLD[thickness],
  };
}
