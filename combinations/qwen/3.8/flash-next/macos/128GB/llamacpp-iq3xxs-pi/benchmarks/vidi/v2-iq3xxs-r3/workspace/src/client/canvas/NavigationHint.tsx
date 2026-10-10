import type { JSX } from 'react';

/** Exact copy from the PRD. */
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use hint shown near the bottom centre until the user's first pan or
 * zoom; it never comes back during the visit (it is not persisted, so a reload
 * shows it again).
 */
export function NavigationHint(props: NavigationHintProps): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
