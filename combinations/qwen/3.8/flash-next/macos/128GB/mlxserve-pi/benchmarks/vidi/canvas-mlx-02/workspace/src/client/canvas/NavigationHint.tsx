import type React from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

// Bottom-centre, first-use hint. Shown until the first real pan/zoom for the
// visit; not persisted, so a reload shows it again.
export function NavigationHint(props: NavigationHintProps): React.JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div
      data-testid="nav-hint"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'rgba(20,20,20,0.82)',
        color: '#fff',
        borderRadius: 999,
        fontSize: 14,
        fontFamily: 'system-ui, sans-serif',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      Drag to move around &middot; Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
