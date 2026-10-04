import type { JSX } from 'react';

/** Shown until the user's first pan or zoom; never persisted across a reload. */
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use navigation hint, near the bottom centre of the board.
 * `visible` is `!hasNavigated`: the hint disappears on the first pan or zoom and does
 * not come back during the visit.
 */
export function NavigationHint({ visible }: NavigationHintProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
