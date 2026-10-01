// src/client/board/UndoButtons.tsx
// Undo/Redo buttons for the left toolbar (story 8).
// Accessible names "Undo" and "Redo"; disabled when the matching history
// is empty or the board cannot be edited.

import type { ReactElement, CSSProperties } from 'react';
import type { UseUndoResult } from './useUndo';

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    width: 40,
    height: 40,
    border: '1px solid #ccc',
    borderRadius: 8,
    background: disabled ? '#e0e0e0' : 'white',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    opacity: disabled ? 0.5 : 1,
    padding: 0,
  };
}

export function UndoButtons(props: UseUndoResult): ReactElement {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        data-testid="undo-btn"
        disabled={!props.canUndo}
        onClick={props.undo}
        style={buttonStyle(!props.canUndo)}
      >
        ↩
      </button>
      <button
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        data-testid="redo-btn"
        disabled={!props.canRedo}
        onClick={props.redo}
        style={buttonStyle(!props.canRedo)}
      >
        ↪
      </button>
    </div>
  );
}
