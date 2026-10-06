/**
 * The fixed left toolbar. Story 2 adds the Sticky note button; story 8 adds Undo and Redo
 * underneath it as their own strip; story 9 puts the two tools - Select and Text - above it.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  /** Creates a note at the centre of the visible board area and starts editing it. */
  onCreateSticky(): void;
  /**
   * False while the room could not load the board (story 4). The buttons stay where they are and
   * say why they are not answering, instead of quietly making an object that belongs to a board
   * nobody has.
   */
  canEdit?: boolean;
  /** Which tool the board is on. Defaults to Select, the tool the board had before this one. */
  tool?: Tool;
  /** Chooses a tool. The board keeps the state, because the keyboard and the viewport need it too. */
  onSelectTool?(tool: Tool): void;
  /** Story 8: the undo strip. Omitted when this board has no history to offer at all. */
  undo?: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo(): void;
    onRedo(): void;
  };
}

/** Tooltip (and accessible hint) of the Sticky note button, as worded in the PRD. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note (N) – or double-click the board';
/** Tooltip of the Select tool button. */
export const SELECT_TOOL_TOOLTIP = 'Select, move and resize (V)';
/** Tooltip of the Text tool button. */
export const TEXT_TOOL_TOOLTIP = 'Text (T) – click the board to write';
/** Why the button is switched off, in the same place the tooltip normally explains it. */
export const STICKY_NOTE_LOCKED_TOOLTIP = 'The board could not be loaded, so it cannot be edited';

export function Toolbar({
  onCreateSticky,
  canEdit = true,
  tool = 'select',
  onSelectTool,
  undo,
}: ToolbarProps): JSX.Element {
  const choose = (next: Tool) => onSelectTool?.(next);

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event: ReactPointerEvent) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className={tool === 'select' ? 'board-toolbar__button is-active' : 'board-toolbar__button'}
        data-testid="select-tool-button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title={SELECT_TOOL_TOOLTIP}
        onClick={() => {
          choose('select');
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 1.6 4 13.4 7.1 10.5 8.9 14.4 10.8 13.5 9 9.7 13 9.2Z" />
        </svg>
      </button>
      <button
        type="button"
        className={tool === 'text' ? 'board-toolbar__button is-active' : 'board-toolbar__button'}
        data-testid="text-tool-button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title={canEdit ? TEXT_TOOL_TOOLTIP : STICKY_NOTE_LOCKED_TOOLTIP}
        disabled={!canEdit}
        onClick={() => {
          if (!canEdit) return;
          choose('text');
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M3 2.8h10v2.4H9.4V14H6.6V5.2H3V2.8Z" />
        </svg>
      </button>

      <div className="board-toolbar__divider" aria-hidden="true" />

      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky-button"
        aria-label="Sticky note (N)"
        title={canEdit ? STICKY_NOTE_TOOLTIP : STICKY_NOTE_LOCKED_TOOLTIP}
        disabled={!canEdit}
        onClick={() => {
          if (!canEdit) return;
          onCreateSticky();
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M2.5 2.75A.75.75 0 0 1 3.25 2h9.5a.75.75 0 0 1 .75.75V9.5L9.5 14H3.25a.75.75 0 0 1-.75-.75v-10.5ZM10 10.25h2.35L10 12.6v-2.35Z"
          />
        </svg>
      </button>
      {undo ? <div className="board-toolbar__divider" aria-hidden="true" /> : null}
      {undo ? (
        <UndoButtons canUndo={undo.canUndo} canRedo={undo.canRedo} onUndo={undo.onUndo} onRedo={undo.onRedo} />
      ) : null}
    </div>
  );
}
