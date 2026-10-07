// NavigationHint: first-use hint near the bottom centre (story 1, nav.hint).

import type { JSX } from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint(props: NavigationHintProps): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
