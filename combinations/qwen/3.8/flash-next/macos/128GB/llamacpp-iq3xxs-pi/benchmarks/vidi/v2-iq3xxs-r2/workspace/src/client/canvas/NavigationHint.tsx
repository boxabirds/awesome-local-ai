import type { JSX } from 'react';

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  readonly visible: boolean;
}

/**
 * First-use hint shown near the bottom centre until the user's first pan or zoom;
 * it never comes back during the visit and is not persisted, so a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <p className="vidi6-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </p>
  );
}
