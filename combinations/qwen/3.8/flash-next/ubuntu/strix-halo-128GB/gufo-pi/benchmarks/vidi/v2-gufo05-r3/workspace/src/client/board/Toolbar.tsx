import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';
import type { Tool } from './useTool';

/** Exact tooltip copy from the PRD (sticky.create_button). */
export const STICKY_NOTE_TOOLTIP = 'Sticky note \u2013 or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Undo / redo, state and commands (story 8): rendered below the tools. */
  undo: UndoApi;
  /**
   * True while the board cannot be edited (its storage could not be read). Every
   * control is disabled: a button that looks usable and does nothing is worse than
   * one that is visibly off.
   */
  locked?: boolean;
  /** Current active tool (story 9). */
  tool?: Tool;
  /** Set the active tool (story 9). */
  onTool?(tool: Tool): void;
}

/**
 * Left-side vertical board toolbar: Select, Text, Sticky note, then Undo/Redo.
 *
 * Pointer events are stopped so a click on the toolbar never reaches the
 * viewport (which would pan the board or clear the selection).
 */
export function Toolbar(props: ToolbarProps) {
  const { onCreateSticky, undo, locked = false, tool = 'select', onTool } = props;
  return (
    <div
      className="board-toolbar"
      data-toolbar=""
      data-locked={locked ? 'true' : 'false'}
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-btn"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        data-tool-select=""
        onClick={onTool ? () => onTool('select') : undefined}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          {'\u2191'}
        </span>
        <span className="board-toolbar-text">Select</span>
      </button>
      <button
        type="button"
        className="board-toolbar-btn"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        data-tool-text=""
        disabled={locked}
        onClick={locked || !onTool ? undefined : () => onTool('text')}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          {'T'}
        </span>
        <span className="board-toolbar-text">Text</span>
      </button>
      <button
        type="button"
        className="board-toolbar-btn"
        aria-label="Sticky note (N)"
        title={STICKY_NOTE_TOOLTIP}
        data-create-sticky=""
        disabled={locked}
        onClick={locked ? undefined : onCreateSticky}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          {'\u25A6'}
        </span>
        <span className="board-toolbar-text">Sticky note</span>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
