import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { Tool } from './useTool';

/**
 * The fixed left toolbar.
 *
 * Story 9 adds Select and Text tool buttons.
 */
export interface ToolbarProps {
  /** A new 200x200 sticky at the centre of the current viewport. */
  onCreateSticky(): void;
  /** The personal undo history's state, for the two buttons. */
  undo: UndoState;
  /** Active tool. */
  tool: Tool;
  /** Set the active tool. */
  onToolChange(tool: Tool): void;
  /** Whether editing is possible. */
  canEdit: boolean;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => {
        // UI chrome never reaches the board underneath.
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={props.tool === 'select'}
        title="Select – or press V"
        disabled={!props.canEdit && props.tool === 'select'}
        onClick={() => props.onToolChange('select')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <path
            d="M4 2l10 8-5 1-2 5z"
            fill={props.tool === 'select' ? '#4285F4' : 'currentColor'}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={props.tool === 'text'}
        title="Text – or press T"
        disabled={!props.canEdit}
        onClick={() => props.onToolChange('text')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <text
            x="4"
            y="14"
            fontSize="13"
            fontFamily="sans-serif"
            fill="currentColor"
            stroke="none"
          >
            T
          </text>
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="13"
            height="13"
            rx="1"
            fill="#FFF3A3"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M5.5 6.5h7M5.5 9.5h7M5.5 12.5h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <UndoButtons {...props.undo} />
    </div>
  );
}