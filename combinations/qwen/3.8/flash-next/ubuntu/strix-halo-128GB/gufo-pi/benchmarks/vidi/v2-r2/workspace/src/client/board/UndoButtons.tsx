import type { ReactElement } from 'react';
import type { UseUndoResult } from './useUndo';

export type UndoButtonsProps = UseUndoResult;

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps): ReactElement {
  return (
    <>
      <button
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        className="board-toolbar-btn"
        onClick={undo}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        data-testid="undo-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M7 4L3 8l4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 8h9a5 5 0 010 10H9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        className="board-toolbar-btn"
        onClick={redo}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        data-testid="redo-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M13 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 8H8a5 5 0 000 10h3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
