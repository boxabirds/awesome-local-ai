export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  readonly visible: boolean;
}

/**
 * First-use hint shown near the bottom centre until the user's first pan/zoom
 * of the visit. Renders nothing when hidden. Not persisted (reload re-shows it).
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
