// Which pen this person is drawing with, for as long as this page is open.
//
// It is session state and nothing more: a colour pressed in the toolbar changes what
// the *next* stroke is drawn with and rewrites nothing that is already on the board.
// That is not a shortcut — it is what a pen is. A red underline drawn under a black
// heading does not repaint the heading, and a document in which every stroke remembered
// the last colour anybody chose would be a document nobody could sketch in two colours.
//
// Nor is it synced: what pen one person is holding is not a thing another person needs
// to be told about, and a board that wrote it down would write on every click of a
// swatch. The strokes themselves are the only thing saved, in the colour they were
// drawn with, which is why a stroke keeps its colour when the person who drew it reloads
// the page and the pen comes back black.
import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, type PenColor, type PenThickness } from '../../shared/config';

export interface UsePenOptionsResult {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): UsePenOptionsResult {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor) => {
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    setThicknessState(next);
  }, []);

  return { color, thickness, setColor, setThickness };
}
