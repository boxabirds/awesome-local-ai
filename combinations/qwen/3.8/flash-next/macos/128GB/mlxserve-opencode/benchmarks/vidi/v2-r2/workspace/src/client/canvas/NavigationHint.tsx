interface NavigationHintProps {
  visible: boolean;
}

export function NavigationHint({ visible }: NavigationHintProps) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '8px 16px',
        borderRadius: 6,
        fontSize: 14,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
