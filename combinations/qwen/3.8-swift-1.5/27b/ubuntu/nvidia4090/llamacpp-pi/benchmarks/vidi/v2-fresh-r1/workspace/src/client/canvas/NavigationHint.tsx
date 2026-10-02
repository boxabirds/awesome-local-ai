// First-use navigation hint, bottom centre. Not persisted: a reload shows
// it again (per PRD, it returns only on a new visit).

import type { JSX } from 'react';

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint(props: { visible: boolean }): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
