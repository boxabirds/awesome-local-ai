import type { JSX } from 'react';

/** Exact first-use navigation hint text. */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * Bottom-centre hint shown until the user's first pan or zoom, then gone for the
 * rest of the visit (it is not remembered between visits).
 */
export function NavigationHint(props: { visible: boolean }): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div
      className="vidi-nav-hint"
      data-testid="navigation-hint"
      role="status"
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
