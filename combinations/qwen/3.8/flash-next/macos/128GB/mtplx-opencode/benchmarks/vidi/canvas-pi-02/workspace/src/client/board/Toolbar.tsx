import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from '../board/useUndo';
import type { Tool } from '../board/useTool';

/**
 * The fixed left toolbar.
 *
 * Story 9 added Select and Text tool buttons.
 * Story 10 adds Shape and Connector buttons.
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
  /** Active tool id from useActiveTool. */
  activeTool?: string;
  /** Set tool via active tool hook. */
  onActiveToolChange?(t: string): void;
  /** Shape kind. */
  shapeKind?: string;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { activeTool = 'select', onActiveToolChange } = props;
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
        aria-pressed={activeTool === 'select'}
        title="Select – or press V"
        disabled={!props.canEdit && activeTool === 'select'}
        onClick={() => onActiveToolChange?.('select')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <path
            d="M4 2l10 8-5 1-2 5z"
            fill={activeTool === 'select' ? '#4285F4' : 'currentColor'}
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
        aria-pressed={activeTool === 'text'}
        title="Text – or press T"
        disabled={!props.canEdit}
        onClick={() => onActiveToolChange?.('text')}
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
        data-testid="tool-shape"
        aria-label="Shape (S)"
        aria-pressed={activeTool === 'shape'}
        title="Shape – or press S"
        disabled={!props.canEdit}
        onClick={() => onActiveToolChange?.('shape')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        aria-pressed={activeTool === 'connector'}
        title="Connector – or press L"
        disabled={!props.canEdit}
        onClick={() => onActiveToolChange?.('connector')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <line x1="3" y1="15" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" />
          <polygon points="15,3 12,5 13,7" fill="currentColor" />
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