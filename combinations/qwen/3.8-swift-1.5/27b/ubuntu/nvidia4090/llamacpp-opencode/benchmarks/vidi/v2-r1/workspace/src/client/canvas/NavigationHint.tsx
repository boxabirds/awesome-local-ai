interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;

  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        bottom: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: 8,
        fontSize: 14,
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
