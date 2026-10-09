import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness
} from '../../shared/config';
import { isPenColor, isPenThickness } from '../../shared/objects/stroke';

// Story 11: pen colour and thickness are remembered for the session (design
// pen.options): plain React state, nothing written to the doc or storage, so
// a page reload returns to the defaults.
export interface PenOptionsApi {
  color: PenColor;
  thickness: PenThickness;
  setColor(value: string): void;
  setThickness(value: string): void;
}

export function usePenOptions(): PenOptionsApi {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((value: string): void => {
    if (isPenColor(value)) setColorState(value);
  }, []);
  const setThickness = useCallback((value: string): void => {
    if (isPenThickness(value)) setThicknessState(value);
  }, []);
  return { color, thickness, setColor, setThickness };
}
