import { type CSSProperties, type ReactNode } from 'react';

interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps): ReactNode {
  const containerStyle: CSSProperties = {
    position: 'fixed',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    zIndex: 10,
  };

  return (
    <div style={containerStyle} data-testid="toolbar">
      <button
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={(e) => {
          e.stopPropagation();
          onCreateSticky();
        }}
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
          padding: 0,
        }}
        data-testid="sticky-note-btn"
      >
        📝
      </button>
    </div>
  );
}
