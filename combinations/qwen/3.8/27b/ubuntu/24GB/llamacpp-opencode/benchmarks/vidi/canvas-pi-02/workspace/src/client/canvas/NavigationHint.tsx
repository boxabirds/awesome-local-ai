import type { ReactElement } from 'react';

export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * Bottom-centre first-use hint. `visible = !hasNavigated`: it shows on load
 * and disappears after the first camera change, staying gone for the visit
 * (nothing is persisted; a reload shows it again).
 */
export function NavigationHint(props: NavigationHintProps): ReactElement | null {
  if (!props.visible) return null;
  return (
    <div className="vidi6-hint" role="status">
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
