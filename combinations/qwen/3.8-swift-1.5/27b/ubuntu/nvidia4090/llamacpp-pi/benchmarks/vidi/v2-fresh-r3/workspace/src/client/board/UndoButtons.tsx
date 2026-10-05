import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';

export type UndoButtonsProps = UseUndoResult;

/**
 * Undo and Redo toolbar buttons. Disabled when their history is empty or
 * the board cannot be edited.
 */
export function UndoButtons(props: UndoButtonsProps): JSX.Element {
  const { canUndo, canRedo, undo, redo } = props;
  return (
    <>
      <button
        type="button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        onClick={undo}
        style={{
          width: 40,
          height: 40,
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 8,
          background: '#fff',
          cursor: canUndo ? 'pointer' : 'default',
          opacity: canUndo ? 1 : 0.4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        <span aria-hidden>↩</span>
      </button>
      <button
        type="button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!canRedo}
        onClick={redo}
        style={{
          width: 40,
          height: 40,
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 8,
          background: '#fff',
          cursor: canRedo ? 'pointer' : 'default',
          opacity: canRedo ? 1 : 0.4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        <span aria-hidden>↪</span>
      </button>
    </>
  );
}
