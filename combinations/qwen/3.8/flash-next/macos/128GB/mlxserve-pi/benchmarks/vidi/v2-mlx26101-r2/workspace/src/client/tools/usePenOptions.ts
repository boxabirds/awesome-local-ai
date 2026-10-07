import { useCallback, useMemo, useState } from 'react';

import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  isPenColor,
  isPenThickness,
  type PenColor,
  type PenThickness,
} from '../../shared/config.js';

/**
 * Which pen this tab is holding (`src/client/tools/usePenOptions.ts`, `pen.options`).
 *
 * Session state, exactly like the active tool and the selection: the ink and the width
 * are facts about what this person is about to draw, not facts about the board, so
 * they are not in the document and a colleague changing theirs changes nothing here.
 * They are not in local storage either, which is the part that is a decision rather
 * than an absence of one: the PRD says "defaults on every load", and a pen remembered
 * from yesterday's meeting is a pen that was not chosen for this one. Someone who
 * wants red every morning presses the red button every morning, which is one click on
 * a toolbar that is already on screen.
 *
 * The two setters check what they were given. A colour the palette does not have is
 * ignored rather than remembered: a pen that would draw in a colour that does not exist
 * is a stroke that comes back from the document unreadable, and the failure the person
 * would see is a line that vanished.
 */
export interface PenOptions {
  /** The ink the next stroke is drawn with. */
  color: PenColor;
  /** The pen the next stroke is drawn with. */
  thickness: PenThickness;
  /** Draw in this ink. A colour the palette has not is not a colour and changes nothing. */
  setColor(color: PenColor): void;
  /** Draw with this pen. A width the palette has not is not a width. */
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor) => {
    if (!isPenColor(next)) return;
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    if (!isPenThickness(next)) return;
    setThicknessState(next);
  }, []);

  return useMemo<PenOptions>(
    () => ({ color, thickness, setColor, setThickness }),
    [color, thickness, setColor, setThickness],
  );
}

export default usePenOptions;
