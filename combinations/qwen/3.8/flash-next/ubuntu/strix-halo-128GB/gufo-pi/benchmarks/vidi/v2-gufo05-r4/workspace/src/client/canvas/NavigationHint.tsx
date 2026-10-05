/**
 * The first-use navigation hint, near the bottom centre of the board.
 *
 * Shown while the user has not panned or zoomed yet during this visit, and gone
 * for good once they do — it is component state, so a reload shows it again.
 */

import type { JSX } from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

export const NAVIGATION_HINT_TEXT = 'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint(props: NavigationHintProps): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div className="vidi6-navigation-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
