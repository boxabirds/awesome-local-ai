const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use navigation hint shown near the bottom centre until the user first
 * pans or zooms. Not persisted, so a reload shows it again.
 */
export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div
      data-testid="navigation-hint"
      className="navigation-hint"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        padding: '6px 14px',
        background: 'rgba(27,29,35,0.82)',
        color: '#fff',
        borderRadius: 999,
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {HINT_TEXT}
    </div>
  );
}

export { HINT_TEXT };
