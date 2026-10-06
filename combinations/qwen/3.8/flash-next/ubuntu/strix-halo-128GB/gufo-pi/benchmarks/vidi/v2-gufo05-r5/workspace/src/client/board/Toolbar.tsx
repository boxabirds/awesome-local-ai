/**
 * The fixed left toolbar. Story 2 adds the Sticky note button; story 8 adds Undo and Redo
 * underneath it as their own strip; story 9 puts the two tools - Select and Text - above it; story
 * 10 adds the two drawing tools - Shape, with its kind menu, and Connector.
 */
import { useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { ShapeKind } from '../../shared/objects/shape';
import { isShapeTool, shapeToolId, type ToolId } from '../../shared/tools';

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
  tool?: ToolId;
  /** Chooses a tool. The board keeps the state, because the keyboard and the viewport need it too. */
  onSelectTool?(tool: ToolId): void;
  /**
   * Story 10: which shape the Shape tool will draw. The kind is chosen here, in the menu under the
   * Shape button, and remembered between visits, so the button and the menu never disagree about
   * what pressing S means.
   */
  shapeKind?: ShapeKind;
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
/** Tooltip of the Shape tool button. */
export const SHAPE_TOOL_TOOLTIP = 'Shape (S) – drag the board to draw, or click for a default size';
/** Tooltip of the Connector tool button. */
export const CONNECTOR_TOOL_TOOLTIP = 'Connector (L) – drag from one object to another';
/** The Shape kind menu, in the order the shapes appear. */
export const SHAPE_KIND_LABELS: Readonly<Record<ShapeKind, string>> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};
/** Why the button is switched off, in the same place the tooltip normally explains it. */
export const STICKY_NOTE_LOCKED_TOOLTIP = 'The board could not be loaded, so it cannot be edited';

export function Toolbar({
  onCreateSticky,
  canEdit = true,
  tool = 'select',
  onSelectTool,
  shapeKind = 'rect',
  undo,
}: ToolbarProps): JSX.Element {
  const choose = (next: ToolId) => onSelectTool?.(next);
  const [kindsOpen, setKindsOpen] = useState(false);

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

      {/* Story 10: the two drawing tools. The Shape button starts drawing the kind the menu last
          chose; the menu beside it is what changes that, so one key - S - can be relied on. */}
      <button
        type="button"
        className={isShapeTool(tool) ? 'board-toolbar__button is-active' : 'board-toolbar__button'}
        data-testid="shape-tool-button"
        aria-label="Shape (S)"
        aria-pressed={isShapeTool(tool)}
        title={canEdit ? SHAPE_TOOL_TOOLTIP : STICKY_NOTE_LOCKED_TOOLTIP}
        disabled={!canEdit}
        onClick={() => {
          if (!canEdit) return;
          choose(shapeToolId(shapeKind));
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            d="M2.8 3.4h10.4v9.2H2.8z"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button board-toolbar__button--menu"
        data-testid="shape-kind-button"
        aria-label="Shape kind"
        aria-haspopup="menu"
        aria-expanded={kindsOpen}
        title="Shape kind"
        disabled={!canEdit}
        onClick={() => {
          if (!canEdit) return;
          setKindsOpen((open) => !open);
        }}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M3 6h10l-5 5z" />
        </svg>
      </button>
      {kindsOpen ? (
        <div
          className="board-toolbar__menu"
          role="menu"
          aria-label="Shape kind"
          data-testid="shape-kind-menu"
        >
          {(['rect', 'ellipse', 'diamond'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitemradio"
              className={
                shapeKind === kind
                  ? 'board-toolbar__menu-item is-active'
                  : 'board-toolbar__menu-item'
              }
              data-shape-kind={kind}
              aria-label={SHAPE_KIND_LABELS[kind]}
              aria-checked={shapeKind === kind}
              onClick={() => {
                choose(shapeToolId(kind));
                setKindsOpen(false);
              }}
            >
              {SHAPE_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={tool === 'connector' ? 'board-toolbar__button is-active' : 'board-toolbar__button'}
        data-testid="connector-tool-button"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title={canEdit ? CONNECTOR_TOOL_TOOLTIP : STICKY_NOTE_LOCKED_TOOLTIP}
        disabled={!canEdit}
        onClick={() => {
          if (!canEdit) return;
          choose('connector');
        }}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            d="M3 12.5 12 4M9.4 3.4H13V7"
          />
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
