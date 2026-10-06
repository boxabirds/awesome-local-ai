/**
 * The fixed left toolbar. Story 2 adds the Sticky note button; story 8 adds Undo and Redo
 * underneath it as their own strip.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  /** Creates a note at the centre of the visible board area and starts editing it. */
  onCreateSticky(): void;
  /**
   * False while the room could not load the board (story 4). The button stays where it is and says
   * why it is not answering, instead of quietly making a note that belongs to a board nobody has.
   */
  canEdit?: boolean;
  /** Story 8: the undo strip. Omitted when this board has no history to offer at all. */
  undo?: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo(): void;
    onRedo(): void;
  };
}

/** Tooltip (and accessible hint) of the Sticky note button, as worded in the PRD. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note – or double-click the board';
/** Why the button is switched off, in the same place the tooltip normally explains it. */
export const STICKY_NOTE_LOCKED_TOOLTIP = 'The board could not be loaded, so it cannot be edited';

export function Toolbar({ onCreateSticky, canEdit = true, undo }: ToolbarProps): JSX.Element {
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
        className="board-toolbar__button"
        data-testid="create-sticky-button"
        aria-label="Sticky note"
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
