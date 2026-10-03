/**
 * Undo and Redo toolbar buttons (story 8, undo.buttons).
 *
 * Rendered in the left toolbar below the tools. Disabled when the matching
 * history is empty or the board cannot be edited.
 */
import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';

export function UndoButtons(props: UseUndoResult): JSX.Element {
  const { canUndo, canRedo, undo, redo } = props;

  return (
    <>
      <button
        data-testid="undo-btn"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        onClick={undo}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ddd',
          borderRadius: 6,
          backgroundColor: canUndo ? '#f5f5f5' : '#eee',
          cursor: canUndo ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: canUndo ? 1 : 0.5,
        }}
      >
        ↩
      </button>
      <button
        data-testid="redo-btn"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!canRedo}
        onClick={redo}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ddd',
          borderRadius: 6,
          backgroundColor: canRedo ? '#f5f5f5' : '#eee',
          cursor: canRedo ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: canRedo ? 1 : 0.5,
        }}
      >
        ↪
      </button>
    </>
  );
}
