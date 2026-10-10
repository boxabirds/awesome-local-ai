import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoButtonState } from './useUndo';
import { DEFAULT_TOOL, type Tool } from './useTool';
import { SHAPE_KIND_KEYS, type ShapeKind } from '../../shared/objects/shape';

/** Exact UI text (PRD: Left-side vertical toolbar with a "Sticky note" button). */
export const SELECT_TOOL_LABEL = 'Select (V)';
export const TEXT_TOOL_LABEL = 'Text (T)';
export const STICKY_BUTTON_LABEL = 'Sticky note (N)';
export const SELECT_TOOL_TOOLTIP = 'Select, move and resize – or press V';
export const TEXT_TOOL_TOOLTIP = 'Text – click the board to write – or press T';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

/** Story 10: the two new tools, and the kind menu the Shape button carries (PRD UI). */
export const SHAPE_TOOL_LABEL = 'Shape (S)';
export const CONNECTOR_TOOL_LABEL = 'Connector (L)';
export const SHAPE_TOOL_TOOLTIP = 'Shape – draw a rectangle, ellipse or diamond – or press S';
export const CONNECTOR_TOOL_TOOLTIP = 'Connector – drag from one object to another – or press L';
/** Story 11: the Pen tool (PRD: "Left toolbar: Pen button"). */
export const PEN_TOOL_LABEL = 'Pen (P)';
export const PEN_TOOL_TOOLTIP = 'Pen – sketch freehand – or press P';
/**
 * Story 12: the Image button. It is an action rather than a mode — it opens the file picker
 * and leaves the pointer where it was — so its button has no pressed state, like the Sticky
 * note button under it (PRD: "Image button or I key").
 */
export const IMAGE_TOOL_LABEL = 'Image (I)';
export const IMAGE_TOOL_TOOLTIP = 'Image – add pictures from this computer – or press I';
export const SHAPE_KIND_MENU_LABEL = 'Shape kind';
/** What the Shape menu calls the three kinds (PRD: "Rectangle (selected), Ellipse, Diamond"). */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface ToolbarProps {
  /** Creates a note in the middle of the visible board area and starts editing it. */
  onCreateSticky(): void;
  /** Story 9: which pointer mode the board is in, and the buttons that change it. */
  tool?: Tool;
  onSelectTool?(): void;
  onTextTool?(): void;
  /** Story 10: which kind the next shape will be, and the menu that picks it. */
  shapeKind?: ShapeKind;
  onShapeTool?(): void;
  onConnectorTool?(): void;
  /** Story 11: the Pen tool, which stays up after every stroke it makes. */
  onPenTool?(): void;
  /** Story 12: the Image button, which opens the file picker (`image.pick`). */
  onImageTool?(): void;
  onShapeKind?(kind: ShapeKind): void;
  /** Story 4: while the board could not be loaded, the Sticky note button is disabled. */
  disabled?: boolean;
  /** Story 8: the undo controls under the Sticky note button; absent off a board. */
  undo?: UndoButtonState;
}

/**
 * The fixed left toolbar: the two pointer tools, the Sticky note button and the undo
 * controls. Its buttons are always available, whatever else is happening on the board.
 * Pointer events stop here so a click on a button never reaches the viewport (which would
 * pan the board and clear the selection).
 *
 * Story 5 moved sharing out of here and into the page that owns the board's address
 * (`share/SharePanel`): sharing is about the link, and the toolbar is about the board.
 *
 * Story 9 put the tools at the top, in the order the PRD gives them — Select, Text, Sticky
 * note — and gave the two pointer modes a pressed state, because a tool you cannot see is a
 * tool you press twice. The Sticky note button is not a tool and has no pressed state: it
 * creates one note where it can see, which is what it has always done.
 *
 * Story 10 adds the Shape and Connector tools between Text and Sticky note. While the Shape
 * tool is up, a small menu appears under its button offering the three kinds, the current one
 * marked, which is what the PRD's "a small menu next to the button shows Rectangle
 * (selected)" asks for. The menu belongs to the tool rather than sitting on the toolbar
 * permanently, because a kind you cannot see the point of is a kind you change by accident.
 */
export function Toolbar({
  onCreateSticky,
  tool = DEFAULT_TOOL,
  onSelectTool,
  onTextTool,
  shapeKind = SHAPE_KIND_KEYS[0],
  onShapeTool,
  onConnectorTool,
  onPenTool,
  onImageTool,
  onShapeKind,
  disabled = false,
  undo,
}: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="vidi6-toolbar"
      data-testid="toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="vidi6-toolbar-button vidi6-toolbar-tool"
        data-testid="tool-select"
        aria-label={SELECT_TOOL_LABEL}
        title={SELECT_TOOL_TOOLTIP}
        aria-pressed={tool === 'select'}
        onClick={onSelectTool}
      >
        <span className="vidi6-tool-glyph vidi6-tool-select" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{SELECT_TOOL_LABEL}</span>
      </button>
      {/* Selecting works on a board this client may not edit; a tool whose whole job is to
          put a thing on the board does not, so it is disabled along with the note button. */}
      <button
        type="button"
        className="vidi6-toolbar-button vidi6-toolbar-tool"
        data-testid="tool-text"
        aria-label={TEXT_TOOL_LABEL}
        title={TEXT_TOOL_TOOLTIP}
        aria-pressed={tool === 'text'}
        onClick={onTextTool}
        disabled={disabled}
      >
        <span className="vidi6-tool-glyph vidi6-tool-text" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{TEXT_TOOL_LABEL}</span>
      </button>
      <button
        type="button"
        className="vidi6-toolbar-button vidi6-toolbar-tool"
        data-testid="tool-shape"
        aria-label={SHAPE_TOOL_LABEL}
        title={SHAPE_TOOL_TOOLTIP}
        aria-pressed={tool === 'shape'}
        onClick={onShapeTool}
        disabled={disabled}
      >
        <span className="vidi6-tool-glyph vidi6-tool-shape" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{SHAPE_TOOL_LABEL}</span>
      </button>
      {/* The kind menu, for as long as the tool it belongs to is up (PRD step 1). */}
      {tool === 'shape' ? (
        <div
          className="vidi6-shape-kinds"
          data-testid="shape-kind-menu"
          role="group"
          aria-label={SHAPE_KIND_MENU_LABEL}
        >
          {SHAPE_KIND_KEYS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="vidi6-shape-kind"
              data-testid={`shape-kind-${kind}`}
              aria-pressed={shapeKind === kind}
              onClick={() => onShapeKind?.(kind)}
            >
              {SHAPE_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="vidi6-toolbar-button vidi6-toolbar-tool"
        data-testid="tool-connector"
        aria-label={CONNECTOR_TOOL_LABEL}
        title={CONNECTOR_TOOL_TOOLTIP}
        aria-pressed={tool === 'connector'}
        onClick={onConnectorTool}
        disabled={disabled}
      >
        <span className="vidi6-tool-glyph vidi6-tool-connector" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{CONNECTOR_TOOL_LABEL}</span>
      </button>
      {/* The Pen stays up while it is being used, so its button is pressed for as long as the
          strokes are coming — which is the point of `pen.stay_active`. */}
      <button
        type="button"
        className="vidi6-toolbar-button vidi6-toolbar-tool"
        data-testid="tool-pen"
        aria-label={PEN_TOOL_LABEL}
        title={PEN_TOOL_TOOLTIP}
        aria-pressed={tool === 'pen'}
        onClick={onPenTool}
        disabled={disabled}
      >
        <span className="vidi6-tool-glyph vidi6-tool-pen" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{PEN_TOOL_LABEL}</span>
      </button>
      {/* Story 12: the Image button. Not a mode — the picker opens, the files land in the
          middle of what this person can see, and the pointer stays on whatever tool it was
          on — so this button is never pressed, like the note button below it. */}
      <button
        type="button"
        className="vidi6-toolbar-button"
        data-testid="tool-image"
        aria-label={IMAGE_TOOL_LABEL}
        title={IMAGE_TOOL_TOOLTIP}
        onClick={onImageTool}
        disabled={disabled}
      >
        <span className="vidi6-tool-glyph vidi6-tool-image" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{IMAGE_TOOL_LABEL}</span>
      </button>
      <button
        type="button"
        className="vidi6-toolbar-button"
        data-testid="create-sticky"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <span className="vidi6-sticky-glyph" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{STICKY_BUTTON_LABEL}</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
