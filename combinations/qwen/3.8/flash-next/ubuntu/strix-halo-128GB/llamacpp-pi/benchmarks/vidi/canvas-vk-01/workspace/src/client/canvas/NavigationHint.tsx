import { type JSX } from 'react';

/** Exact copy of the first-use navigation hint (PRD nav.hint). */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * Bottom-centre hint shown until the user's first pan or zoom this visit.
 * It is not persisted: a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps): JSX.Element | null {
  if (!visible) return null;

  return (
    <div className="navigation-hint" data-testid="navigation-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
