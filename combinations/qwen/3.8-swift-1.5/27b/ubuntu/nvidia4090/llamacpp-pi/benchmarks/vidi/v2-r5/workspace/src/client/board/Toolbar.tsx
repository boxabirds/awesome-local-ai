// src/client/board/Toolbar.tsx
import type { ReactElement } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';

export interface ToolbarProps {
  onCreateSticky: () => void;
  disabled?: boolean;
  undo?: UseUndoResult;
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
        onClick={props.disabled ? undefined : props.onCreateSticky}
        disabled={props.disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: props.disabled ? '#e0e0e0' : '#FFF59D',
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: props.disabled ? 0.5 : 1,
        }}
      >
        📝
      </button>
      {props.undo && <UndoButtons {...props.undo} />}
    </div>
  );
}
