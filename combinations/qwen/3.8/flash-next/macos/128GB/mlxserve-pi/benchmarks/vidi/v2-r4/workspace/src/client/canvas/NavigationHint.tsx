import { type CSSProperties } from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

/** Exact first-use text (PRD "Golden path" step 2). */
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

const style: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
};

/**
 * Bottom-centre hint shown while the user has not navigated yet during this
 * visit. `visible` comes from `!hasNavigated`, which latches on the first real
 * camera change, so the hint never comes back until the page is reloaded.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;

  return (
    <div className="navigation-hint" data-testid="navigation-hint" style={style}>
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
