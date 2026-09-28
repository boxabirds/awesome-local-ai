/**
 * Undo and Redo toolbar buttons (story 8, undo.buttons).
 * Rendered in the left toolbar below the tools.
 */
import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';

export function UndoButtons(props: UseUndoResult): JSX.Element {
  return (
    <>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={props.undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M7 4L3 8l4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 8h8a5 5 0 0 1 0 10H8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={props.redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M13 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 8H9a5 5 0 0 0 0 10h3"
            fill="none"
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
