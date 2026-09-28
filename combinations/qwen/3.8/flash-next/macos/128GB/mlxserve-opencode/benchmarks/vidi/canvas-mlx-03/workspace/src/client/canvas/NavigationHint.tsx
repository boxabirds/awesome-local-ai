export interface NavigationHintProps {
  visible: boolean;
}

/**
 * First-use navigation hint shown bottom-centre. It disappears after the first
 * real pan/zoom and does not return until the page reloads (visibility is owned
 * by the caller; nothing is persisted here).
 */
export function NavigationHint(props: NavigationHintProps) {
  if (!props.visible) return null;
  return (
    <div
      data-testid="nav-hint"
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 20,
        transform: 'translateX(-50%)',
        background: 'rgba(44,47,54,0.88)',
        color: '#ffffff',
        padding: '8px 14px',
        borderRadius: 999,
        fontSize: 13,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
