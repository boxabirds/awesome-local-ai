import type { JSX } from 'react';

/** Exact copy of the first-use navigation hint (design "nav.hint_display"). */
export const NAVIGATION_HINT_TEXT = 'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

/**
 * Bottom-centre hint shown until the user's first pan or zoom of the visit.
 * Not persisted: a page reload shows it again.
 */
export function NavigationHint({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <p className="navigation-hint" data-testid="navigation-hint" aria-live="polite">
      {NAVIGATION_HINT_TEXT}
    </p>
  );
}
