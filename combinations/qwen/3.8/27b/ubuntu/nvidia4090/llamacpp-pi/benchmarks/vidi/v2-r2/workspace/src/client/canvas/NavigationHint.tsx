import type { JSX } from 'react';

/** Exact first-use hint text (PRD). */
const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/**
 * First-use navigation hint, bottom centre. Visible until the first pan or
 * zoom of the visit, then hidden for good (only a page reload shows it
 * again).
 */
export function NavigationHint(props: { visible: boolean }): JSX.Element | null {
  if (!props.visible) {
    return null;
  }
  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 64,
        transform: 'translateX(-50%)',
        zIndex: 10,
        padding: '6px 14px',
        background: 'rgba(255, 255, 255, 0.94)',
        border: '1px solid #d9d9d0',
        borderRadius: 999,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
        fontSize: 13,
        color: '#44443c',
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
