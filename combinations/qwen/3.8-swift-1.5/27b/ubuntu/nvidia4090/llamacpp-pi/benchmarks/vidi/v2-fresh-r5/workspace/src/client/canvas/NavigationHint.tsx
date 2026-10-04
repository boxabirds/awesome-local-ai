import type { JSX } from 'react';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use navigation hint shown near the bottom centre of the board. Renders
 * nothing when `visible` is false. Not persisted: a page reload shows it again.
 */
export function NavigationHint(props: NavigationHintProps): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div
      className="navigation-hint"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 48,
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        borderRadius: 20,
        font: '13px/1.2 system-ui, sans-serif',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
