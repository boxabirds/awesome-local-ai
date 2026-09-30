import type { ReactElement } from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

const HINT_TEXT = 'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

// First-use hint, shown until the first pan/zoom of the visit. Not persisted: a
// page reload shows it again (per PRD).
export function NavigationHint({ visible }: NavigationHintProps): ReactElement | null {
  if (!visible) return null;
  return (
    <div className="navigation-hint" role="status" data-board-ui data-testid="navigation-hint">
      {HINT_TEXT}
    </div>
  );
}

export { HINT_TEXT };
