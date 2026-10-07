import type { ReactNode } from 'react';
import type { UseUndoResult } from './useUndo';

interface UndoButtonsProps extends UseUndoResult {
  /** When true, buttons are visually shown as disabled but still respond (for canEdit gate). */
  canEdit?: boolean;
}

export function UndoButtons({ canUndo, canRedo, undo, redo, canEdit }: UndoButtonsProps): ReactNode {
  const isDisabled = !canEdit || false;

  return (
    <>
      <button
        aria-label="Undo"
        aria-disabled={!canUndo || isDisabled}
        disabled={!canUndo || isDisabled}
        title="Undo (Ctrl/Cmd+Z)"
        onClick={(e) => {
          e.stopPropagation();
          undo();
        }}
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '6px',
          backgroundColor: '#fff',
          cursor: canUndo && !isDisabled ? 'pointer' : 'default',
          opacity: canUndo && !isDisabled ? 1 : 0.5,
          fontSize: '18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
        data-testid="undo-btn"
      >
        ↩️
      </button>
      <button
        aria-label="Redo"
        aria-disabled={!canRedo || isDisabled}
        disabled={!canRedo || isDisabled}
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={(e) => {
          e.stopPropagation();
          redo();
        }}
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '6px',
          backgroundColor: '#fff',
          cursor: canRedo && !isDisabled ? 'pointer' : 'default',
          opacity: canRedo && !isDisabled ? 1 : 0.5,
          fontSize: '18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
        data-testid="redo-btn"
      >
        ↪️
      </button>
    </>
  );
}
