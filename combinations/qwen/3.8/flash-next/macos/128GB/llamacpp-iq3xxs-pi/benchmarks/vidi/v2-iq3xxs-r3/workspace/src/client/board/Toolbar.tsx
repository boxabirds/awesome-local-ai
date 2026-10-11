import type { JSX } from 'react';

import { UndoButtons } from './UndoButtons';
import type { UndoActions } from './useUndo';
import type { ToolController } from './useTool';

/**
 * Accessible name and tooltip of the creation button (the tooltip also states the
 * double-click and key alternatives; PRD accessibility constraint).
 */
export const CREATE_STICKY_LABEL = 'Sticky note (N)';
/** The accessible names of the two tools (story 9, `text.tool_ui`). */
export const SELECT_TOOL_LABEL = 'Select (V)';
export const TEXT_TOOL_LABEL = 'Text (T)';

/**
 * Left tool toolbar: the tools the pointer can hold, the one button that makes
 * an object without a tool (story 2's sticky note), and undo/redo under them
 * (story 8). Buttons are added here when later object stories land.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * The tool this screen is holding, and the way to change it (story 9,
   * `text.tool_ui`): `aria-pressed` says which one it is, and the Text tool is
   * offered only where writing works.
   */
  tool?: ToolController;
  /**
   * Disabled while the board cannot be written to (`canEdit`,
   * persist.client_status): a board the room could not read takes no new notes,
   * no text, and no Text tool — while Select stays, because looking still works.
   */
  disabled?: boolean;
  /**
   * Undo and Redo, under the tools (story 8): they act on this person's own
   * history, so they are disabled by an empty history as much as by a board
   * that cannot be written to — which `useUndo` has already settled.
   */
  undo: UndoActions;
}

export function Toolbar({ onCreateSticky, tool, disabled = false, undo }: ToolbarProps): JSX.Element {
  const textActive = tool?.tool === 'text';
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {tool ? (
        <>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="tool-select"
            aria-label={SELECT_TOOL_LABEL}
            aria-pressed={tool.tool === 'select'}
            title={
              tool.tool === 'select'
                ? `${SELECT_TOOL_LABEL} — the board pans and selects`
                : `${SELECT_TOOL_LABEL} — press V`
            }
            onClick={() => tool.setTool('select')}
          >
            {/* The pointer arrow. */}
            <svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill="currentColor"
                d="M4 2.5 12.2 8l-3.6.6 2 4.4-1.7.8-2-4.4-2.4 2.1L4 2.5Z"
              />
            </svg>
          </button>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="tool-text"
            aria-label={TEXT_TOOL_LABEL}
            aria-pressed={textActive}
            title={
              disabled
                ? `${TEXT_TOOL_LABEL} — this board could not be loaded`
                : `${TEXT_TOOL_LABEL} — click the board to write`
            }
            // Selecting is not writing, so Select stays clickable; a tool that
            // makes things goes where the making goes (TC-15).
            disabled={disabled}
            onClick={() => tool.setTool('text')}
          >
            {/* A capital T with a baseline under it. */}
            <svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill="currentColor"
                d="M3 2.6h10V4.4h-3.4v8.2h-1.6V4.4H5.4V2.6H3Zm-.4 10.8h10.8v1.6H2.6v-1.6Z"
              />
            </svg>
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label={CREATE_STICKY_LABEL}
        title={
          disabled
            ? `${CREATE_STICKY_LABEL} — this board could not be loaded`
            : `${CREATE_STICKY_LABEL} — press N or double-click the board`
        }
        disabled={disabled}
        onClick={onCreateSticky}
      >
        {/* A note with a folded corner. */}
        <svg
          aria-hidden="true"
          focusable="false"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="currentColor"
            d="M2.5 2h11v8.2L10.2 14h-7.7V2Zm9 8h2.5l-2.5 2.4V10ZM4.5 4.5v1.6h7V4.5h-7Zm0 3v1.6h4.5v-1.6H4.5Z"
          />
        </svg>
      </button>
      {/* Undo and redo are tools too, and they sit under the ones that make
          things: the order is the order people reach for them in. */}
      <UndoButtons {...undo} />
    </div>
  );
}
