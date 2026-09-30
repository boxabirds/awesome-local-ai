import type { JSX } from 'react';

import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoButtonsProps;
  /** Current active tool */
  tool?: Tool;
  /** Set the active tool */
  onToolChange?(tool: Tool): void;
}

/** The tooltip of the Sticky note button, exactly as the product names it. */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

/**
 * The left-side board toolbar: Select, Text, Sticky note tool buttons + undo.
 *
 * Pointer events stop at the toolbar so clicking a tool never reaches the board
 * (which would pan it or clear the selection).
 */
export function Toolbar({
  onCreateSticky,
  disabled,
  undo,
  tool = 'select',
  onToolChange,
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        onClick={() => onToolChange?.('select')}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 2l12 9.5-5.5 1.2L13 18l-2.5 1-2.5-5.2L4 17V2z"
          />
        </svg>
        <span>Select</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 4h12v3h-2V6h-3v9h2v2H7v-2h2V6H6v1H4V4z"
          />
        </svg>
        <span>Text</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 3.75A.75.75 0 0 1 4.75 3h7.69c.2 0 .39.08.53.22l3.81 3.81c.14.14.22.33.22.53v8.69a.75.75 0 0 1-.75.75H4.75a.75.75 0 0 1-.75-.75Zm1.5.75v11h11V8h-3.25a.75.75 0 0 1-.75-.75V4.5ZM13.5 6.5H16l-2.5-2.5Z"
          />
        </svg>
        <span>Sticky note</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
