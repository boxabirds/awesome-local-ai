import { useCallback, useState } from "react";
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLOR_NAMES,
  PEN_THICKNESS_NAMES,
  type PenColor,
  type PenThickness,
} from "../../shared/config";

/**
 * `tools.usePenOptions` — the pen's colour and thickness (`pen.options`).
 *
 * Plain component state, deliberately *not* board content: the choice belongs to
 * this tab and this visit. It is never written to the Y.Doc, so it is not synced
 * to anybody else's screen and not undoable — undoing a stroke brings the drawing
 * back, not the swatch that was clicked before it. Switching tools, or reloading
 * the page, starts from the defaults.
 *
 * A value that is not one of the model's colours or thicknesses is ignored, so a
 * stray call cannot put a stroke colour the model would refuse into the tool.
 */
export interface PenOptionsApi {
  readonly color: PenColor;
  readonly thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptionsApi {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor) => {
    if (!PEN_COLOR_NAMES.includes(next)) return;
    setColorState((previous) => (previous === next ? previous : next));
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    if (!PEN_THICKNESS_NAMES.includes(next)) return;
    setThicknessState((previous) => (previous === next ? previous : next));
  }, []);

  return { color, thickness, setColor, setThickness };
}
