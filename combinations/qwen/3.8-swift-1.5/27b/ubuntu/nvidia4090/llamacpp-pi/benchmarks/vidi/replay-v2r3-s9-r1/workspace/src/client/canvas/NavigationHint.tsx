export function NavigationHint(props: { visible: boolean }): React.ReactElement | null {
  if (!props.visible) return null;

  return (
    <div
      data-testid="navigation-hint"
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: 8,
        fontSize: 13,
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
