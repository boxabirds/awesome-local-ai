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
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.9)',
        borderRadius: '8px',
        padding: '8px 16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: '14px',
        color: '#555',
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
