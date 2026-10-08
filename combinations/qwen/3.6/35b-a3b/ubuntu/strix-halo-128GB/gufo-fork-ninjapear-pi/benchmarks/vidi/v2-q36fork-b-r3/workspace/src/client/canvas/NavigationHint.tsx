import React from 'react';

export function NavigationHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.7)',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: 8,
        fontSize: 14,
        zIndex: 100,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
