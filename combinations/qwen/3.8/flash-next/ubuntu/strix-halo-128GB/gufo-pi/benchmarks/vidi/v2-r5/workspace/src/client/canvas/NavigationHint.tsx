export interface NavigationHintProps {
  visible: boolean;
}

/** Exact first-use hint text (PRD `nav.hint`). */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * First-use hint shown near the bottom centre until the user pans or zooms.
 * Not persisted: a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;

  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
