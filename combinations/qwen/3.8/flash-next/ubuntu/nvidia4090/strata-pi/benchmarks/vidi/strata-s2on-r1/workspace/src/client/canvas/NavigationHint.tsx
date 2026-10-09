export const NAVIGATION_HINT_TEXT =
  "Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom";

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use hint, shown near the bottom centre until the user pans or zooms
 * for the first time during this visit. Never persisted: a reload shows it
 * again.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div className="nav-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
