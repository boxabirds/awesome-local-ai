export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use hint shown near the bottom centre of the board until the user's
 * first pan or zoom. Not persisted: a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      Drag to move around &middot; Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
