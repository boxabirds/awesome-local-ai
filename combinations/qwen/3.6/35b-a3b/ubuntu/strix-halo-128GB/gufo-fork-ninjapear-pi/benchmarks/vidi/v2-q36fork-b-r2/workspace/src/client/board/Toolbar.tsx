import * as React from 'react';

interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { onCreateSticky } = props;

  return (
    <div
      className="toolbar"
      style={{
        position: 'fixed',
        left: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        zIndex: 99,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onCreateSticky()}
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        📝
      </button>
    </div>
  );
}
