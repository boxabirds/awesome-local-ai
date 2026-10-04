import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoBinding } from './useUndo';

interface ToolbarProps {
  onCreateSticky: () => void;
  /** When true the create button is disabled (board failed to load). */
  disabled?: boolean;
  /** Undo/redo binding (story 8). */
  undo?: UndoBinding;
}

/**
 * Fixed left-side toolbar with a Sticky note button and undo/redo buttons.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky, disabled = false, undo } = props;

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
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          border: '1px solid rgba(0,0,0,0.2)',
          background: disabled ? '#E8EAED' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        +
      </button>
      {undo && (
        <div style={{ height: '1px', background: 'rgba(0,0,0,0.15)', margin: '0 2px' }} />
      )}
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
