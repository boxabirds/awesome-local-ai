import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** When true the button is inert (the board is not editable, e.g. load failed). */
  disabled?: boolean;
  /** Undo/redo state and actions (story 8). */
  undo?: Pick<UseUndoResult, 'canUndo' | 'canRedo' | 'undo' | 'redo'>;
}

/**
 * Fixed left-side vertical toolbar with a Sticky note button and undo/redo.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-vidi6="board-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <span className="board-toolbar-sticky-icon" aria-hidden="true">📝</span>
        <span className="board-toolbar-sticky-label">Sticky note</span>
      </button>
      {props.undo && <UndoButtons undo={props.undo} />}
    </div>
  );
}
