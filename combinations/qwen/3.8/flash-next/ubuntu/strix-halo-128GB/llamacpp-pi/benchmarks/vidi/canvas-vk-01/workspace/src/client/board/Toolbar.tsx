import { type JSX, type ReactNode } from 'react';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** False while the board cannot be edited (persist.load_failure). */
  editable?: boolean;
  /** Active pointer tool (story 9); Select is the default. */
  tool?: Tool;
  onSelectTool?(tool: Tool): void;
  /** Undo/Redo buttons rendered below the tools. */
  undoButtons?: ReactNode;
}

/**
 * Fixed left-side toolbar with the Select and Text tool buttons, the Sticky
 * note button and undo/redo buttons.
 */
export function Toolbar({
  onCreateSticky,
  editable = true,
  tool = 'select',
  onSelectTool,
  undoButtons,
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select"
        data-testid="tool-select"
        title="Select – or press V"
        onClick={() => onSelectTool?.('select')}
        aria-pressed={tool === 'select'}
      >
        <span aria-hidden="true">&#x2191;</span>
      </button>
      <button
        type="button"
        aria-label="Text"
        data-testid="tool-text"
        title="Text – or press T"
        onClick={() => onSelectTool?.('text')}
        disabled={!editable}
        aria-disabled={!editable}
        aria-pressed={tool === 'text'}
      >
        <span aria-hidden="true">T</span>
      </button>
      <button
        type="button"
        aria-label="Sticky note"
        data-testid="create-sticky"
        title="Sticky note \u2013 or double-click the board"
        onClick={onCreateSticky}
        disabled={!editable}
        aria-disabled={!editable}
      >
        <span aria-hidden="true">&#x1F4CC;</span>
      </button>
      {undoButtons}
    </div>
  );
}
