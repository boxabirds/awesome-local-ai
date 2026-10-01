/**
 * First-use navigation hint, shown near the bottom centre until the user pans
 * or zooms for the first time this visit. Never persisted: a reload shows it
 * again.
 */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint({
  visible,
}: {
  visible: boolean;
}): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
