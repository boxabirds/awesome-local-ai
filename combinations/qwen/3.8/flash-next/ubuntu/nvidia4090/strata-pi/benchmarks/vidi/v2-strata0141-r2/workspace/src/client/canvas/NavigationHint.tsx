import type { JSX } from 'react';
import { NAVIGATION_HINT_TEXT } from '../../shared/config';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use hint, shown near the bottom centre until the user pans or zooms.
 * Not persisted: a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps): JSX.Element | null {
  if (!visible) {
    return null;
  }
  return (
    <div
      className="navigation-hint"
      data-vidi6-overlay="navigation-hint"
      data-testid="navigation-hint"
      role="status"
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
