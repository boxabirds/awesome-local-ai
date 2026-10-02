import React from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;

  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '8px 16px',
        borderRadius: 6,
        fontSize: 14,
        pointerEvents: 'none',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
