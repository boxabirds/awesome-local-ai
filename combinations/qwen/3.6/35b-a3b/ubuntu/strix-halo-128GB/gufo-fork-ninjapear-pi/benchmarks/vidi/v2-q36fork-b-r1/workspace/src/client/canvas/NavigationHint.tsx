import { type CSSProperties, type ReactNode } from 'react';

export function NavigationHint(props: { visible: boolean }): ReactNode {
  if (!props.visible) return null;

  const style: CSSProperties = {
    position: 'fixed',
    bottom: '70px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    color: '#fff',
    borderRadius: '20px',
    fontSize: '14px',
    zIndex: 10,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={style} data-testid="navigation-hint">
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
