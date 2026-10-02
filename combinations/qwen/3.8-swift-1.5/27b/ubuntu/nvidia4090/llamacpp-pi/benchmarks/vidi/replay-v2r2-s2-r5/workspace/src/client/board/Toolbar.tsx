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
      style={{
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Sticky note"
        data-testid="sticky-note-btn"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '6px',
          backgroundColor: '#FFF59D',
          cursor: 'pointer',
          fontSize: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        +
      </button>
    </div>
  );
}
