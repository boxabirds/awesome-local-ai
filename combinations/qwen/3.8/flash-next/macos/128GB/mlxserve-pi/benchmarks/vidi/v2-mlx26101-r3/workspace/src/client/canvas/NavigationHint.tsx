import type { JSX } from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

/** Shown near the bottom centre until the user's first pan or zoom of the visit. */
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint({ visible }: NavigationHintProps): JSX.Element | null {
  if (!visible) {
    return null;
  }
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
