import type { ReactElement } from 'react';
/**
 * First-use navigation hint, near the bottom centre.
 */
export function NavigationHint(props: { visible: boolean }): ReactElement | null {
  if (!props.visible) return null;
  return (
    <div
      className="navigation-hint"
      role="note"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        padding: '8px 14px',
        fontSize: 13,
        color: '#3c4149',
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
