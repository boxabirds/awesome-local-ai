import type { JSX } from 'react';

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * Bottom-centre first-use hint. Visible until the first pan or zoom of the
 * visit (`visible = !hasNavigated`); never persisted, so a reload shows it
 * again.
 */
export function NavigationHint(props: { visible: boolean }): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="note">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
