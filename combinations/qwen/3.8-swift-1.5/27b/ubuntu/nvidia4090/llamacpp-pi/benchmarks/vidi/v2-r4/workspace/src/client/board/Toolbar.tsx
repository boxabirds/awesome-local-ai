import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  /** Per-user undo controls (story 8). Omit to hide the buttons. */
  undo?: UseUndoResult;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky, disabled, undo } = props;
  return (
    <div
      data-testid="toolbar"
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
        onClick={disabled ? undefined : onCreateSticky}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          backgroundColor: disabled ? '#E5E7EB' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        📝
      </button>
      {undo && <UndoButtons undo={undo} disabled={disabled} />}
    </div>
  );
}
