import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { isPenColor, isPenThickness } from '../../shared/objects/stroke';

/**
 * What the next stroke will be drawn with (`pen.options`).
 *
 * Session state, in React and nowhere else: it is not written to the document, so it is not
 * shared, not undone, and not remembered on reload — the same rule the tool itself and the
 * selection follow (a board with six people has six pens in hand). What *is* remembered is
 * every stroke already on the board, which carries the colour and thickness it was drawn with
 * and is never restyled by a later click on a swatch.
 */
export interface PenOptions {
  readonly color: PenColor;
  readonly thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  // Validated on the way in, the same way the model validates what it is asked to write:
  // a caller that names a colour the settings do not have keeps the one it had.
  const setColorSafely = useCallback((next: PenColor): void => {
    if (isPenColor(next)) setColor(next);
  }, []);
  const setThicknessSafely = useCallback((next: PenThickness): void => {
    if (isPenThickness(next)) setThickness(next);
  }, []);

  return useMemo(
    () => ({ color, thickness, setColor: setColorSafely, setThickness: setThicknessSafely }),
    [color, thickness, setColorSafely, setThicknessSafely],
  );
}
