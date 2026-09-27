// First-use navigation hint (see spec: nav.hint_display).
// Shown until the first pan or zoom of the visit; not persisted.

import type { JSX } from 'react';

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint(props: { visible: boolean }): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <p data-testid="nav-hint" className="nav-hint">
      {NAVIGATION_HINT_TEXT}
    </p>
  );
}
