import type { JSX } from 'react';

interface ToolbarProps {
  onCreateSticky: () => void;
}

/**
 * Fixed left-side toolbar with a Sticky note button.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky } = props;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board toolbar"
      onPointerDown={handlePointerDown}
      style={{
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="create-sticky-btn"
        onClick={onCreateSticky}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          border: '1px solid rgba(0,0,0,0.2)',
          background: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}
      >
        +
      </button>
    </div>
  );
}
