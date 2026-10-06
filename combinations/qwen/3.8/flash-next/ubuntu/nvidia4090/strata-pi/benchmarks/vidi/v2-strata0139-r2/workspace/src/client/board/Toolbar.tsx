import { UndoButtons } from "./UndoButtons";
import type { UndoState } from "./useUndo";
import type { Tool } from "./useTool";

/**
 * Left-side board toolbar: the Select and Text tools (story 9), the Sticky note
 * tool, and story 8's Undo and Redo.
 *
 * Every tool button says its key in its accessible name — "Select (V)", "Text
 * (T)", "Sticky note (N)" — so the shortcuts are findable without reading a help
 * page. The Sticky note button's tooltip spells out the alternative (double-click
 * the board). Clicking it creates a note in the middle of the visible board area,
 * wherever the board has been panned.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
  /** This tab's undo state: the buttons only ever reach this tab's history. */
  undo: UndoState;
  /** Story 4: a board that could not be loaded has nothing to write. */
  canEdit?: boolean;
  /** Story 9: the board's tool. Without it the two tool buttons are inert. */
  tool?: { tool: Tool; setTool(tool: Tool): void };
}

export const STICKY_TOOL_TOOLTIP = "Sticky note (N) \u2013 centre of view";

export function Toolbar({ onCreateSticky, undo, canEdit = true, tool }: ToolbarProps) {
  const active = tool?.tool ?? "select";

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="tool-button"
        data-testid="tool-select"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={active === "select"}
        onClick={() => tool?.setTool("select")}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Select</span>
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="tool-text"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={active === "text"}
        disabled={!canEdit}
        onClick={() => tool?.setTool("text")}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Text</span>
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title={STICKY_TOOL_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Sticky note</span>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
