import { useState, useCallback } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '@shared/config';
import type { PenColor, PenThickness } from '@shared/config';

/** Session-only colour/thickness state for the pen tool. Reset on page reload. */
export function usePenOptions() {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  return {
    color,
    thickness,
    setColor,
    setThickness,
  };
}
