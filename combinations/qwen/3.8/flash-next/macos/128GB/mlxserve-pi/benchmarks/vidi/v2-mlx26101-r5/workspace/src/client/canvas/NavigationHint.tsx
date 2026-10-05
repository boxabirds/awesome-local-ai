export interface NavigationHintProps {
  visible: boolean;
}

/** Text shown to a first-time visitor of the board. */
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * First-use hint, bottom-centre. Shown until the user's first pan or zoom and
 * never again during the visit; nothing is persisted, so a reload shows it
 * again.
 */
export function NavigationHint({ visible }: NavigationHintProps): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <div className="navigation-hint" data-testid="navigation-hint">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
