import type { JSX } from 'react';

/** The exact first-use hint text from the PRD. */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * The first-use navigation hint, shown near the bottom centre until the user
 * pans or zooms for the first time. Never persisted: a reload shows it again.
 */
export function NavigationHint({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      className="navigation-hint"
      data-testid="navigation-hint"
      role="status"
      aria-live="polite"
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
