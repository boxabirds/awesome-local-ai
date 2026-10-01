import type { MouseEvent as ReactMouseEvent } from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  tool: Tool;
  onToolChange(tool: Tool): void;
  canEdit: boolean;
  onCreateSticky(): void;
  undo: UseUndoResult;
}

/**
 * The fixed left-side tool palette: Select, Text, Sticky note buttons, plus Undo/Redo.
 */
export function Toolbar({
  tool,
  onToolChange,
  canEdit,
  onCreateSticky,
  undo,
}: ToolbarProps): React.JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select tool"
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onToolChange('select');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 2l10 8-4.5 1L13 16l-2 1-3.5-5L4 14V2Z" />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text tool"
        disabled={!canEdit}
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onToolChange('text');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 4h12v3h-1.5V5.5h-4V15H12v1.5H8V15h1.5V5.5h-4V7H4V4Z" />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onCreateSticky();
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="#FFF59D" stroke="#c9b458" d="M3 3h14v10l-4 4H3V3Z" />
          <path fill="#e6d488" d="M13 17v-4h4l-4 4Z" />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
