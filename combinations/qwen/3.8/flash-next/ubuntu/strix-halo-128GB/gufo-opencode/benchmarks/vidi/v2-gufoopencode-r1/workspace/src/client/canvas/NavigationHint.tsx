import type { CSSProperties } from 'react';
export const NAVIGATION_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

const hintStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 24,
  transform: 'translateX(-50%)',
  padding: '8px 14px',
  background: 'rgba(17, 24, 39, 0.85)',
  color: '#f9fafb',
  borderRadius: 8,
  fontSize: 14,
  whiteSpace: 'nowrap',
  pointerEvents: 'none'
};

export function NavigationHint(props: { visible: boolean }) {
  if (!props.visible) return null;
  return (
    <div data-testid="navigation-hint" role="status" style={hintStyle}>
      {NAVIGATION_HINT_TEXT}
    </div>
  );
}
