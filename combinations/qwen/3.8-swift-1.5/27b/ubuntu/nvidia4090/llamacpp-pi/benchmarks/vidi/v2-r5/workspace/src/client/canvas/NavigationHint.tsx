// src/client/canvas/NavigationHint.tsx
import type { ReactElement } from 'react';

export function NavigationHint(props: { visible: boolean }): ReactElement | null {
  if (!props.visible) return null;

  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.9)',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 14,
        color: '#555',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
