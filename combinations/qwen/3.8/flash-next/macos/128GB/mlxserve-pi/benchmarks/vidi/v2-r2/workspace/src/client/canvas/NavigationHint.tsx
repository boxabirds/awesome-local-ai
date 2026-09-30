// First-use navigation hint. Shown until the user's first pan or zoom of the
// visit, then gone for good (a page reload is the only way it returns).

import type { JSX } from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint({ visible }: NavigationHintProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="nav-hint" data-testid="nav-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
