import { type CSSProperties, type ReactNode } from 'react';

/** The exact first-use hint text (PRD: Golden path step 2). */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

const hintStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 24,
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  borderRadius: 999,
  backgroundColor: 'rgba(32, 33, 36, 0.82)',
  color: '#ffffff',
  fontFamily: 'var(--vidi6-font)',
  fontSize: 13,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

/**
 * First-use navigation hint, shown near the bottom centre until the user's
 * first pan or zoom of the visit. Never persisted: a page reload shows it
 * again (PRD: Explicit non-behaviours).
 */
export function NavigationHint({ visible }: { visible: boolean }): ReactNode {
  if (!visible) return null;
  return (
    <div data-testid="navigation-hint" role="status" style={hintStyle}>
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
