import { UndoButtons } from "./UndoButtons";
import type { UndoState } from "./useUndo";
import type { Tool } from "./useTool";
import { SHAPE_KINDS, type ShapeKind } from "../../shared/config";

/**
 * Left-side board toolbar: the Select and Text tools (story 9), the Shape and
 * Connector tools (story 10), the Pen (story 11), the Image button (story 12), the
 * Sticky note tool, and story 8's Undo and Redo.
 *
 * Every tool button says its key in its accessible name — "Select (V)", "Text
 * (T)", "Shape (S)", "Connector (L)", "Pen (P)", "Image (I)", "Sticky note (N)" — so the
 * shortcuts are findable without reading a help page. The Sticky note button's
 * tooltip spells
 * out the alternative (double-click the board). Clicking it creates a note in the
 * middle of the visible board area, wherever the board has been panned.
 *
 * Shape and Connector are *modes*: clicking one arms the board for that gesture
 * rather than making something on its own. While the Shape tool is armed its three
 * kinds are offered beside it, because which kind the next drawn shape is comes
 * from that choice and not from the drag. The Pen is a mode as well; its colour and
 * thickness are offered in `PenToolbar`, beside this toolbar.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
  /** This tab's undo state: the buttons only ever reach this tab's history. */
  undo: UndoState;
  /** Story 4: a board that could not be loaded has nothing to write. */
  canEdit?: boolean;
  /** Story 9: the board's tool. Without it the two tool buttons are inert. */
  tool?: { tool: Tool; setTool(tool: Tool): void };
  /** Story 10: the kind the next drawn shape is. */
  shapeKind?: ShapeKind;
  onShapeKind?(kind: ShapeKind): void;
}

export const STICKY_TOOL_TOOLTIP = "Sticky note (N) \u2013 centre of view";

/** What each shape kind is called in the toolbar's kind menu. */
const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
};

export function Toolbar({ onCreateSticky, undo, canEdit = true, tool, shapeKind = "rect", onShapeKind }: ToolbarProps) {
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
        data-testid="tool-shape"
        aria-label="Shape (S)"
        title="Shape (S)"
        aria-pressed={active === "shape"}
        disabled={!canEdit}
        onClick={() => tool?.setTool("shape")}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Shape</span>
      </button>
      {active === "shape" ? (
        <div className="shape-kind-menu" data-testid="shape-kind-menu" role="group" aria-label="Shape kind">
          {SHAPE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="tool-button tool-button-compact"
              data-testid={`shape-kind-${kind}`}
              aria-label={SHAPE_KIND_LABELS[kind]}
              title={SHAPE_KIND_LABELS[kind]}
              aria-pressed={shapeKind === kind}
              onClick={() => onShapeKind?.(kind)}
            >
              <span className="tool-label">{SHAPE_KIND_LABELS[kind]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="tool-button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        title="Connector (L)"
        aria-pressed={active === "connector"}
        disabled={!canEdit}
        onClick={() => tool?.setTool("connector")}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Connector</span>
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="tool-pen"
        aria-label="Pen (P)"
        title="Pen (P)"
        aria-pressed={active === "pen"}
        disabled={!canEdit}
        onClick={() => tool?.setTool("pen")}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Pen</span>
      </button>
      {/* Story 12 (`image.pick`): the Image button is not a mode the board waits
          in — it opens the system file picker, and the tool goes straight back to
          Select once the picker is closed (App wires that). */}
      <button
        type="button"
        className="tool-button"
        data-testid="tool-image"
        aria-label="Image (I)"
        title={`Image (I) \u2013 drop, paste or choose files`}
        aria-pressed={active === "image"}
        disabled={!canEdit}
        onClick={() => tool?.setTool("image")}
      >
        <span className="tool-glyph" aria-hidden="true" />
        <span className="tool-label">Image</span>
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
