export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * First-use hint shown bottom-centre until the user pans or zooms. Not persisted:
 * a reload shows it again.
 */
export function NavigationHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="navigation-hint" role="status" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
