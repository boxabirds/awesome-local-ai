import type { JSX } from 'react';
import type { UndoBinding } from './useUndo';

/**
 * Undo/redo toolbar buttons (story 8, undo.controls).
 *
 * `button[aria-label="Undo"]` / `button[aria-label="Redo"]` with tooltips
 * showing the shortcuts; disabled when the respective stack is empty or the
 * board is not editable (undo.own).
 */
export function UndoButtons(props: UndoBinding): JSX.Element {
  const { canUndo, canRedo, undo, redo } = props;

  const buttonStyle = (enabled: boolean): React.CSSProperties => ({
    width: '40px',
    height: '40px',
    borderRadius: '6px',
    border: '1px solid rgba(0,0,0,0.2)',
    background: enabled ? '#F1F3F4' : '#E8EAED',
    cursor: enabled ? 'pointer' : 'not-allowed',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    opacity: enabled ? 1 : 0.5,
  });

  return (
    <div data-testid="undo-controls" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        data-testid="undo-btn"
        onClick={undo}
        disabled={!canUndo}
        style={buttonStyle(canUndo)}
      >
        ↶
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        data-testid="redo-btn"
        onClick={redo}
        disabled={!canRedo}
        style={buttonStyle(canRedo)}
      >
        ↷
      </button>
    </div>
  );
}
