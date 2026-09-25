/**
 * Story 11 · the pen options (design "Pen tool and options").
 *
 * Which ink and which width the *next* stroke will use. This is deliberately
 * session state in one tab: like the active tool and the selection it is never
 * written to the `Y.Doc`, so changing the pen here cannot restyle a sketch
 * somebody has already drawn (PRD `pen.options`) and it never reaches anybody
 * else's screen.
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

export interface PenOptionsState {
  /** The ink the next stroke will use. */
  color: PenColor;
  /** The width the next stroke will use. */
  thickness: PenThickness;
  /** Choose an ink; an unknown name is ignored. */
  setColor(color: PenColor): void;
  /** Choose a width; an unknown name is ignored. */
  setThickness(thickness: PenThickness): void;
}

/**
 * Hold this tab's pen options, starting from the story defaults.
 *
 * A name that is not in {@link PEN_COLORS} / {@link PEN_THICKNESS_WORLD} is
 * refused, so a stray call cannot put the toolbar into a state the model would
 * later reject.
 */
export function usePenOptions(): PenOptionsState {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor) => {
    if (!Object.prototype.hasOwnProperty.call(PEN_COLORS, next)) return;
    setColorState((prev) => (prev === next ? prev : next));
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    if (!Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, next)) return;
    setThicknessState((prev) => (prev === next ? prev : next));
  }, []);

  return { color, thickness, setColor, setThickness };
}
