import type { JSX } from 'react';

import type { UndoButtonsProps } from './UndoButtons.js';
import { UndoButtons } from './UndoButtons.js';
import type { ToolId } from '../tools/useActiveTool.js';
import { SHAPE_KINDS, SHAPE_KIND_NAMES, type ShapeKind } from '../../shared/config.js';

/** Exact tooltip of the Sticky note button (PRD "Structure"). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

/**
 * What the same button says when the board will not take content. The tooltip is
 * where the reason goes: the button is the thing the user just tried to use, and
 * a control that will not respond has to say why where the pointer already is.
 */
export const BOARD_LOCKED_TOOLTIP = 'Sticky note \u2013 this board could not be loaded';

export interface ToolbarProps {
  /** Create a sticky note in the middle of what the user is looking at. */
  onCreateSticky(): void;
  /**
   * The active tool, and the way to change it (story 9, four tools by story 10).
   * Both optional, and the tool buttons are drawn only when they are given: a board
   * that was built before there were tools - and there is one, story 2's component
   * test - draws the toolbar it always drew rather than a Select button it cannot
   * press.
   */
  tool?: ToolId;
  /** Make a tool the active one ('Select' and 'Text' buttons, and the shortcuts).
   * Omitted together with `tool` by a board with no tools. */
  onTool?: (tool: ToolId) => void;
  /**
   * Which shape the Shape tool will draw (story 10). Shown as the pressed state of
   * the three kind buttons, which appear under the Shape button while it is the tool.
   */
  shapeKind?: ShapeKind;
  /** Draw that shape next. */
  onShapeKind?: (kind: ShapeKind) => void;
  /**
   * False while the board will not accept new content (a board the room could not
   * load - see `canEdit`). The button is then shown disabled rather than hidden:
   * the tool is still there, and what is missing is the board's ability to take
   * it, which is a fact about the board and not about the toolbar.
   */
  canEdit?: boolean;
  /**
   * This person's own undo/redo state (story 8), which is why these two buttons
   * can be greyed out on a board that is full of changes: everything a colleague
   * did is in the document and in none of this tab's history. Omitted by a board
   * that keeps no history at all, which renders neither button.
   */
  undo?: UndoButtonsProps;
}

/**
 * The left-side vertical toolbar. Story 2 contributes the Sticky note button;
 * later stories add their tools here.
 */
export function Toolbar({
  onCreateSticky,
  tool,
  onTool,
  shapeKind = 'rect',
  onShapeKind,
  canEdit = true,
  undo,
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      // The toolbar is page chrome: a click or wheel over it must not reach the
      // board (which would pan, zoom or clear the selection).
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {onTool ? (
        <>
          {/* The two tools of this build, as a pressed/unpressed pair. `tool` is
              this tab's own pointer mode - it is not board content, and a
              colleague changing theirs changes nothing here - so `aria-pressed`
              is what says which one the person is in. The Text tool is greyed out
              with everything else that writes, because a click in Text mode puts
              an object on the board. */}
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="select-tool-button"
            aria-label="Select (V)"
            title="Select, move and resize (V)"
            aria-pressed={tool === 'select' ? 'true' : 'false'}
            onClick={() => onTool('select')}
          >
            <span className="board-toolbar-icon" aria-hidden="true">
              &#8598;
            </span>
            <span className="board-toolbar-label">Select</span>
          </button>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="text-tool-button"
            aria-label="Text (T)"
            title="Write text anywhere on the board (T)"
            aria-pressed={tool === 'text' ? 'true' : 'false'}
            disabled={!canEdit}
            onClick={() => onTool('text')}
          >
            <span className="board-toolbar-icon" aria-hidden="true">
              T
            </span>
            <span className="board-toolbar-label">Text</span>
          </button>
          {/* Story 10's two drawing tools. They are the first tools that make a thing
              rather than a cursor: the Shape tool waits for a drag and the Connector
              tool waits for a release, so both are greyed out with everything else
              that writes, and both leave on their own the moment they have made their
              one thing. */}
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="shape-tool-button"
            aria-label="Shape (S)"
            title="Draw a rectangle, ellipse or diamond (S)"
            aria-pressed={tool === 'shape' ? 'true' : 'false'}
            disabled={!canEdit}
            onClick={() => onTool('shape')}
          >
            <span className="board-toolbar-icon" aria-hidden="true">
              &#9645;
            </span>
            <span className="board-toolbar-label">Shape (S)</span>
          </button>
          {tool === 'shape' && onShapeKind ? (
            // The kind is chosen here rather than being a tool of its own, because the
            // three shapes are one gesture with three answers: press S, pick a shape,
            // draw. The popup is the toolbar growing a second row, not a floating
            // panel, so it is out of the way of what is being drawn and is part of the
            // same click trail.
            <span className="board-toolbar-popup" data-testid="shape-kind-menu" role="group" aria-label="Shape kind">
              {SHAPE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="board-toolbar-kind"
                  data-testid="shape-kind-button"
                  data-kind={kind}
                  aria-label={SHAPE_KIND_NAMES[kind]}
                  title={`Draw a ${SHAPE_KIND_NAMES[kind]}`}
                  aria-pressed={shapeKind === kind ? 'true' : 'false'}
                  onClick={() => onShapeKind(kind)}
                >
                  {SHAPE_KIND_NAMES[kind]}
                </button>
              ))}
            </span>
          ) : null}
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="connector-tool-button"
            aria-label="Connector (L)"
            title="Draw an arrow between two objects (L)"
            aria-pressed={tool === 'connector' ? 'true' : 'false'}
            disabled={!canEdit}
            onClick={() => onTool('connector')}
          >
            <span className="board-toolbar-icon" aria-hidden="true">
              &#8594;
            </span>
            <span className="board-toolbar-label">Connector (L)</span>
          </button>
          {/* Story 11's pen. The icon is the only drawing on the board that is not
              described by its own button's shape: a squiggle, because a squiggle is
              what the tool is for. It is greyed out with everything else that writes,
              and - unlike the three tools above it - it does not leave after it has
              drawn one thing: a person holding a pen is sketching, and sketching is
              several lines (`pen.stay_active`). */}
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="pen-tool-button"
            aria-label="Pen (P)"
            title="Sketch freehand (P)"
            aria-pressed={tool === 'pen' ? 'true' : 'false'}
            disabled={!canEdit}
            onClick={() => onTool('pen')}
          >
            <span className="board-toolbar-icon" aria-hidden="true">
              &#12316;
            </span>
            <span className="board-toolbar-label">Pen (P)</span>
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky-button"
        aria-label="Sticky note"
        title={canEdit ? STICKY_BUTTON_TOOLTIP : BOARD_LOCKED_TOOLTIP}
        disabled={!canEdit}
        onClick={onCreateSticky}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          &#9635;
        </span>
        {/* The shortcut in the label, because this is the button whose key is not
            on it: the story added `N` to the board and the label is where a
            person looks for it. The accessible name stays "Sticky note" - the
            tooltip carries the same sentence. */}
        <span className="board-toolbar-label">Sticky note (N)</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
