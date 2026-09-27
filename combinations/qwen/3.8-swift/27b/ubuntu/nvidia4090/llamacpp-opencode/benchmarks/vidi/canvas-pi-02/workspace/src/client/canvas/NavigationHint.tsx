// Bottom-centre first-use navigation hint. Shown until the first pan or
// zoom of the visit; never persisted (reload shows it again).

import type { ReactElement } from 'react';

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint(props: NavigationHintProps): ReactElement | null {
  if (!props.visible) return null;
  return (
    <div className="nav-hint" data-testid="nav-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
