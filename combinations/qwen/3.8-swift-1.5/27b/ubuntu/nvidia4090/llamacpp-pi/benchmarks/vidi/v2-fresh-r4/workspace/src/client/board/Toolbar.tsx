import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';

/** Board tools: select (default) and text (click to place a text object). */
export type BoardTool = 'select' | 'text';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Activate the text tool (T). */
  onToolText?(): void;
  /** Activate the select tool (V / Escape). */
  onToolSelect?(): void;
  /** The currently active tool (for the pressed state). */
  activeTool?: BoardTool;
  /** When true the buttons are inert (the board is not editable, e.g. load failed). */
  disabled?: boolean;
  /** Undo/redo state and actions (story 8). */
  undo?: Pick<UseUndoResult, 'canUndo' | 'canRedo' | 'undo' | 'redo'>;
}

/**
 * Fixed left-side vertical toolbar with a Sticky note button, a Text tool
 * button (story 9) and undo/redo.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const textActive = props.activeTool === 'text';
  return (
    <div
      className="board-toolbar"
      data-vidi6="board-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`board-toolbar-select${props.activeTool === 'select' ? ' board-toolbar-select--active' : ''}`}
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={props.activeTool === 'select'}
        disabled={props.disabled}
        onClick={() => props.onToolSelect?.()}
      >
        <span className="board-toolbar-select-icon" aria-hidden="true">⬚</span>
        <span className="board-toolbar-select-label">Select</span>
      </button>
      <button
        type="button"
        className="board-toolbar-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <span className="board-toolbar-sticky-icon" aria-hidden="true">📝</span>
        <span className="board-toolbar-sticky-label">Sticky note</span>
      </button>
      <button
        type="button"
        className={`board-toolbar-text${textActive ? ' board-toolbar-text--active' : ''}`}
        aria-label="Text (T)"
        title="Text – press T, then click anywhere on the board"
        aria-pressed={textActive}
        disabled={props.disabled}
        onClick={() => props.onToolText?.()}
      >
        <span className="board-toolbar-text-icon" aria-hidden="true">T</span>
        <span className="board-toolbar-text-label">Text</span>
      </button>
      {props.undo && <UndoButtons undo={props.undo} />}
    </div>
  );
}
