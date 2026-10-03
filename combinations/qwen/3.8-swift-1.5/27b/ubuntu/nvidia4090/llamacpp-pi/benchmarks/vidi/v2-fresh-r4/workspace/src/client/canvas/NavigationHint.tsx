import type { JSX } from 'react';

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/** First-use navigation hint, near the bottom centre. Not persisted. */
export function NavigationHint(props: { visible: boolean }): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div className="nav-hint" data-vidi6="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
