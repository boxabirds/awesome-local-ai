/**
 * The first-use navigation hint: one line near the bottom centre of the board,
 * shown until the user pans or zooms for the first time in this visit. It is not
 * persisted, so a page reload shows it again.
 */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom';

export function NavigationHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
