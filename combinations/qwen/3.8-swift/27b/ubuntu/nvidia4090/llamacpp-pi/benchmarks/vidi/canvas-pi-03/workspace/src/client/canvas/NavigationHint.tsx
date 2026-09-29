import type { JSX } from 'react';

export function NavigationHint(props: { visible: boolean }): JSX.Element | null {
  if (!props.visible) return null;

  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: 20,
        fontSize: 13,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
