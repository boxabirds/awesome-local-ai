import type { JSX } from 'react';

/** Exact hint text from the PRD. */
const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * First-use navigation hint, near the bottom centre. Not persisted: a page
 * reload shows it again.
 */
export function NavigationHint({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 72,
        transform: 'translateX(-50%)',
        background: 'rgba(30, 30, 28, 0.85)',
        color: '#ffffff',
        padding: '8px 14px',
        borderRadius: 8,
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {HINT_TEXT}
    </div>
  );
}
