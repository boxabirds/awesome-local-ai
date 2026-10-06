/**
 * The pen's colour and thickness (story 11).
 *
 * Session state, and nothing else: what the next stroke will be drawn with belongs to the person
 * holding the pen, not to the board. It is not written to the document, not shared with anybody else
 * on the board, and not remembered when the page is reloaded - while a stroke that has already been
 * drawn keeps the colour and thickness it was drawn with for ever, because those live in the stroke.
 */
import { useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenOptions {
  readonly color: PenColor;
  readonly thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return { color, thickness, setColor, setThickness };
}
