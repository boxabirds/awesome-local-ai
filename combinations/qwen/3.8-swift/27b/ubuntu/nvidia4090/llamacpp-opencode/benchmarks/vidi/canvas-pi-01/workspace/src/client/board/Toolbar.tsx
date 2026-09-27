// Left-side board toolbar (see spec: sticky.toolbar, board.text_tool,
// undo.buttons). Fixed position; the Select/Text tool pair (V/T), the Sticky
// note button (creates a note at the centre of the visible board area and
// starts editing it). Below the tools: the Undo and Redo buttons (story 8),
// disabled while the matching history is empty.

import type { JSX } from 'react';
import type { UndoUi } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';
export const SELECT_TOOL_ARIA = 'Select (V)';
export const TEXT_TOOL_ARIA = 'Text (T)';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** False while the board is load_failed: the buttons are disabled. */
  disabled?: boolean;
  /** Undo/redo state and actions for this tab's history (story 8). */
  undo: UndoUi;
  /** Active tool (board.text_tool); the pair is reflected with aria-pressed. */
  tool?: Tool;
  onToolChange?: (tool: Tool) => void;
}

export function Toolbar({
  onCreateSticky,
  disabled = false,
  undo,
  tool = 'select',
  onToolChange,
}: ToolbarProps): JSX.Element {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-testid="toolbar"
      className="toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar-select"
        aria-label={SELECT_TOOL_ARIA}
        aria-pressed={tool === 'select'}
        title={SELECT_TOOL_ARIA}
        onClick={() => onToolChange?.('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 2l12 8.5-5.1.9L13 17l-2.3 1.4-2.1-5.4L4 17V2z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-text"
        aria-label={TEXT_TOOL_ARIA}
        aria-pressed={tool === 'text'}
        title={TEXT_TOOL_ARIA}
        disabled={disabled}
        onClick={() => onToolChange?.('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v3h-1.5V4.5H11V16h1.5V17.5H7.5V16H9V4.5H4.5V6H3V3z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        onClick={onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v9l-5 5H3V3zm11 11.5L15.5 14H14V11.5h-1.5V14H3v-11h11v7.5z"
            fill="currentColor"
          />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
