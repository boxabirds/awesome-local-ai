import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';

export interface UndoButtonsProps {
  undo: UseUndoResult;
  disabled?: boolean;
}

const buttonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  border: '1px solid #ccc',
  borderRadius: 8,
  backgroundColor: disabled ? '#E5E7EB' : '#f8fafc',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  opacity: disabled ? 0.5 : 1,
});

/**
 * Undo/redo toolbar buttons (story 8). Disabled state tracks the per-user
 * stacks only: remote changes never enable either button.
 */
export function UndoButtons(props: UndoButtonsProps): JSX.Element {
  const { undo, disabled } = props;
  const undoDisabled = disabled || !undo.canUndo;
  const redoDisabled = disabled || !undo.canRedo;

  return (
    <div data-testid="undo-buttons" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={undoDisabled}
        onClick={() => undo.undo()}
        style={buttonStyle(undoDisabled)}
      >
        ↩
      </button>
      <button
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={redoDisabled}
        onClick={() => undo.redo()}
        style={buttonStyle(redoDisabled)}
      >
        ↪
      </button>
    </div>
  );
}
