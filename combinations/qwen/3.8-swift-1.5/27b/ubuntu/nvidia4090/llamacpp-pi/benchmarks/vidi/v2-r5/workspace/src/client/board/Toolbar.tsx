// src/client/board/Toolbar.tsx
import type { ReactElement } from 'react';

export interface ToolbarProps {
  onCreateSticky: () => void;
}

export function Toolbar(props: ToolbarProps): ReactElement {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="create-sticky-btn"
        onClick={props.onCreateSticky}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        📝
      </button>
    </div>
  );
}
