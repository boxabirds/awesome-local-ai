export interface NavigationHintProps {
  visible: boolean;
}

/** Exact copy from the PRD; the middle dot is U+00B7. */
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * First-use hint, shown bottom-centre until the user's first pan or zoom.
 * It is not persisted: a reload shows it again (story 1 scope).
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <p className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </p>
  );
}
