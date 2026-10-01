export function NavigationHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="note"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'rgba(30,30,30,0.85)',
        color: '#fff',
        borderRadius: 8,
        font: '14px system-ui, sans-serif',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      Drag to move around · Ctrl/Cmd + scroll or pinch to zoom
    </div>
  );
}
