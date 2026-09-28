export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use hint shown near the bottom centre of the board until the user
 * pans or zooms for the first time. Not persisted: a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div
      className="navigation-hint"
      data-testid="navigation-hint"
      role="status"
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
