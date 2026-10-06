export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use hint shown near the bottom centre of the board until the user pans or
 * zooms. It is deliberately not remembered: a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div className="navigation-hint" role="status" data-testid="navigation-hint">
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
