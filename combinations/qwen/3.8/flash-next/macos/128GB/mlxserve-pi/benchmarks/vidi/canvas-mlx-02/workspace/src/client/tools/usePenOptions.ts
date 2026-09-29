// What the pen draws with (story 11, pen.options): the colour and thickness the
// NEXT stroke will use.
//
// Both are this tab's tool state, exactly like which tool is open and which shape
// kind the Shape tool will draw - never the doc's. A person who picks purple and
// then draws ten strokes has not recoloured anybody else's pen, has not written a
// byte to the shared board, and gets the product default back on the next load
// (pen.options: "remembered until the page reloads").
import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config.ts';
import { isPenColor, isPenThickness } from '../../shared/objects/stroke.ts';
import type { PenColor, PenThickness } from '../../shared/config.ts';

export interface PenOptionsState {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptionsState {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  // Both setters refuse what is not in their table, so a stray value can never
  // reach createStroke - which would refuse it anyway, and quietly draw nothing.
  const setColor = useCallback((next: PenColor) => {
    if (!isPenColor(next)) return;
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    if (!isPenThickness(next)) return;
    setThicknessState(next);
  }, []);

  return { color, thickness, setColor, setThickness };
}
