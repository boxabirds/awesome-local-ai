import { useState } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';
import type { ToolId } from '../tools/useActiveTool';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

/** Exact tooltip copy from the PRD (sticky.create_button). */
export const STICKY_NOTE_TOOLTIP = 'Sticky note \u2013 or double-click the board';

/** What each tool is called on the button, and the key that selects it. */
const TOOL_LABELS: Record<string, { label: string; key: string; icon: string }> = {
  shape: { label: 'Shape', key: 'S', icon: '\u25A1' },
  connector: { label: 'Connector', key: 'L', icon: '\u2192' },
};

/** The three kinds, in the order the menu shows them. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

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
  /** The active tool. */
  tool?: ToolId;
  /** Set the active tool. */
  onTool?(tool: ToolId): void;
  /** The kind the Shape tool will draw next. */
  shapeKind?: ShapeKind;
  /** Pick the kind from the Shape menu. */
  onShapeKind?(kind: ShapeKind): void;
}

/**
 * Left-side vertical board toolbar: Select, Text, Sticky note, Shape (with its kind
 * menu), Connector, then Undo/Redo.
 *
 * Pointer events are stopped so a click on the toolbar never reaches the viewport
 * (which would pan the board or clear the selection).
 *
 * The Shape button does two things at once, which is why it has a menu beside it
 * rather than three buttons: pressing the button chooses the Shape tool with whatever
 * kind is already chosen (that is what the S key does too), and pressing the menu
 * changes the kind without changing the tool. A person who draws five rectangles should
 * not have to re-pick the rectangle five times.
 */
export function Toolbar(props: ToolbarProps) {
  const {
    onCreateSticky,
    undo,
    locked = false,
    tool = 'select',
    onTool,
    shapeKind = 'rect',
    onShapeKind,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  const pickShape = (): void => {
    // Choosing the Shape tool also closes the menu: the menu belongs to the choice,
    // not to the tool being up.
    setMenuOpen(false);
    onTool?.('shape');
  };

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
      <div className="board-toolbar-shape-group" data-shape-group="">
        <button
          type="button"
          className="board-toolbar-btn"
          aria-label={`Shape (${TOOL_LABELS.shape.key}) \u2013 ${SHAPE_KIND_LABELS[shapeKind]}`}
          aria-pressed={tool === 'shape'}
          aria-expanded={menuOpen}
          title={`Shape (${TOOL_LABELS.shape.key}) \u2013 ${SHAPE_KIND_LABELS[shapeKind]}`}
          data-tool-shape=""
          disabled={locked}
          onClick={locked || !onTool ? undefined : pickShape}
        >
          <span className="board-toolbar-icon" aria-hidden="true">
            {TOOL_LABELS.shape.icon}
          </span>
          <span className="board-toolbar-text">Shape</span>
        </button>
        <button
          type="button"
          className="board-toolbar-mini"
          aria-label="Shape kind menu"
          aria-expanded={menuOpen}
          data-shape-menu-toggle=""
          disabled={locked}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{'\u25BE'}</span>
        </button>
        {menuOpen ? (
          <div className="board-toolbar-menu" role="menu" aria-label="Shape kind" data-shape-menu="">
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitemradio"
                aria-checked={shapeKind === kind}
                data-shape-kind={kind}
                className="board-toolbar-menu-item"
                onClick={() => {
                  onShapeKind?.(kind);
                  setMenuOpen(false);
                }}
              >
                {SHAPE_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="board-toolbar-btn"
        aria-label={`Connector (${TOOL_LABELS.connector.key})`}
        aria-pressed={tool === 'connector'}
        title={`Connector (${TOOL_LABELS.connector.key})`}
        data-tool-connector=""
        disabled={locked}
        onClick={locked || !onTool ? undefined : () => onTool('connector')}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          {TOOL_LABELS.connector.icon}
        </span>
        <span className="board-toolbar-text">Connector</span>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
