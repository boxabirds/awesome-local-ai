interface ToolbarProps {
  onCreateSticky: () => void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="toolbar"
      onPointerDown={handlePointerDown}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 8,
        padding: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      <button
        aria-label="Sticky note"
        data-testid="create-sticky"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 6,
          backgroundColor: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
        }}
      >
        +
      </button>
    </div>
  );
}
