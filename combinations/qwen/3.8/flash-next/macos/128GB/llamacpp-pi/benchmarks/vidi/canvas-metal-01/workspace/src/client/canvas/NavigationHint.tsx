// First-use navigation hint (design "First-use navigation hint).
// Purely presentational: shown until the user first pans or zooms, and never
// persisted, so a reload shows it again.
import type { JSX } from "react";

import { NAVIGATION_HINT_TEXT } from "../../shared/config";

export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint(props: NavigationHintProps): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div
      className="vidi6-hint"
      data-board-part="navigation-hint"
      data-testid="navigation-hint"
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
