import React from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint(props: NavigationHintProps): React.ReactElement | null {
  if (!props.visible) return null;

  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        bottom: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '8px 16px',
        borderRadius: 20,
        fontSize: 14,
        whiteSpace: 'nowrap',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
