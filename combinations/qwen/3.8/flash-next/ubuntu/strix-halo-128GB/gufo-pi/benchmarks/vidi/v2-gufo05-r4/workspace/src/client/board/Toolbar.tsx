/**
 * The left-side tool bar: what the pointer does when you click the board, plus the two
 * things that act on the board as a whole.
 *
 * Two kinds of button live here, and the difference is worth stating because it is how
 * the board thinks:
 *
 *  - a **tool** is a mode. It lights up while it is held, changes what a click on the
 *    board means, and is left by Escape or by its key. Select is the resting tool; the
 *    Text tool of story 9 is the first mode the board offers (`text.tool`).
 *  - an **action** happens when you press it and nothing is left switched on. Sticky note
 *    is still that: one press, one note in the middle of the view, ready to type
 *    (`sticky.create` — story 2's behaviour, story 9's shortcut `N`).
 *
 * A tool the board cannot offer is disabled rather than silent: on a board that failed to
 * load the Text tool says so by being switched off (`text.limit_access`).
 */

import { useCallback, useState, type JSX } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';
import type { UndoActions } from './useUndo';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Which tool the pointer is holding (`text.tool`, `tools.active_tool`). Defaults to Select. */
  tool?: ToolId;
  /** Hold the pointer: clicks select, and nothing is placed. */
  onSelectTool?(): void;
  /** Hold the Text tool: the next click on the board places text there. */
  onTextTool?(): void;
  /**
   * Hold the Shape tool: the next drag draws a shape that size, and the next click drops a
   * standard one (`shape.create_drag`, `shape.create_click`).
   */
  onShapeTool?(): void;
  /** Hold the Connector tool: the next drag draws an arrow (`connector.draw`). */
  onConnectorTool?(): void;
  /**
   * Hold the Pen tool: every drag draws a line until the pen is put down (`pen.draw`). Unlike the
   * other drawing tools it stays held after a stroke, so it is picked up and put down rather than
   * spent.
   */
  onPenTool?(): void;
  /**
   * Which shape the Shape tool will draw (`shape.kinds`). Defaults to the first kind, so a
   * palette that says nothing draws a rectangle.
   */
  shapeKind?: ShapeKind;
  /** Choose the shape the Shape tool draws, without leaving the tool. */
  onShapeKind?(kind: ShapeKind): void;
  /**
   * False when the board cannot be written to (story 4: it could not be loaded). Buttons
   * that would change the board say so by being disabled rather than by doing nothing
   * when clicked.
   */
  disabled?: boolean;
  /**
   * The undo controls (story 8): the two buttons beside the tools, enabled only when this
   * client has a step of their own to reverse.
   */
  undo?: UndoActions;
}

/** Pointer and double-click gestures belong to the palette, not to the board. */
const stopPointer = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

/** What each kind is called in the menu and in a button's accessible name. */
const KIND_LABEL: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond'
};

/**
 * The shape's outline, drawn as a filled ring so one `currentColor` covers both the palette
 * button and the menu row: an icon that showed a *filled* square would promise a fill the tool
 * does not choose.
 */
function ShapeKindIcon({ kind }: { kind: ShapeKind }): JSX.Element {
  if (kind === 'ellipse') {
    return (
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M10 3c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7Zm0 2c-3.4 0-6 2.3-6 5s2.6 5 6 5 6-2.3 6-5-2.6-5-6-5Z"
      />
    );
  }
  if (kind === 'diamond') {
    return <path fill="currentColor" d="M10 2 18 10 10 18 2 10 10 2Zm0 2.8L4.8 10 10 15.2 15.2 10 10 4.8Z" />;
  }
  return <path fill="currentColor" fillRule="evenodd" d="M3 3h14v14H3V3Zm2 2v10h10V5H5Z" />;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky, onSelectTool, onTextTool, onShapeTool, onConnectorTool, onPenTool, onShapeKind, undo } = props;
  const disabled = props.disabled === true;
  const shapeKind = props.shapeKind ?? SHAPE_KINDS[0];
  // The kind menu is open. It is the palette's own business: an open menu is not a tool, and
  // closing the palette closes it.
  const [kindsOpen, setKindsOpen] = useState(false);
  const toggleKinds = useCallback(() => setKindsOpen((open) => !open), []);
  const chooseKind = useCallback(
    (kind: ShapeKind) => {
      setKindsOpen(false);
      onShapeKind?.(kind);
    },
    [onShapeKind]
  );

  return (
    <div
      className="vidi6-toolbar"
      data-vidi6="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stopPointer}
      onDoubleClick={stopPointer}
    >
      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-select"
        aria-label="Select (V)"
        aria-pressed={props.tool === 'select'}
        title="Select what is on the board – V"
        onClick={onSelectTool}
      >
        {/* An arrow pointer, drawn inline so there is no icon dependency. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 2.5 15.5 9.2l-4.9 1.1 2.6 5.3-2.3 1.1-2.6-5.3L4 15.6V2.5Z" />
        </svg>
      </button>

      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-sticky"
        aria-label="Sticky note (N)"
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Sticky note – or double-click the board (N)'}
        onClick={onCreateSticky}
      >
        {/* A folded-corner note, drawn inline so there is no icon dependency. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M3 3.5A1.5 1.5 0 0 1 4.5 2h11A1.5 1.5 0 0 1 17 3.5V12l-5 5H4.5A1.5 1.5 0 0 1 3 15.5v-12Z"
          />
          <path fill="rgba(0,0,0,0.25)" d="M17 12h-3.5a1.5 1.5 0 0 0-1.5 1.5V17l5-5Z" />
        </svg>
      </button>

      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-text"
        aria-label="Text (T)"
        aria-pressed={props.tool === 'text'}
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Text – click the board to place it (T)'}
        onClick={onTextTool}
      >
        {/* A plain capital T: this tool draws text and nothing else. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M3 3h14v3.2h-1.9V4.9h-3.8v10.2h2.1v1.9H6.6v-1.9h2.1V4.9H4.9v1.3H3V3Z" />
        </svg>
      </button>

      <span className="vidi6-tool-split" data-vidi6="tool-shape-group">
        <button
          type="button"
          className="vidi6-tool"
          data-vidi6="tool-shape"
          data-kind={shapeKind}
          aria-label="Shape (S)"
          aria-pressed={props.tool === 'shape'}
          aria-disabled={disabled}
          disabled={disabled}
          title={disabled ? 'This board could not be loaded' : 'Shape \u2013 drag to size it, or click for a standard one (S)'}
          onClick={onShapeTool}
        >
          {/* An outlined square, whichever kind is chosen: the Shape tool draws outlines. */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <ShapeKindIcon kind={shapeKind} />
          </svg>
        </button>
        <button
          type="button"
          className="vidi6-tool vidi6-tool--caret"
          data-vidi6="tool-shape-kind"
          aria-label="Shape kind"
          aria-haspopup="true"
          aria-expanded={kindsOpen}
          aria-disabled={disabled}
          disabled={disabled}
          title="Rectangle, ellipse or diamond"
          onClick={toggleKinds}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M1.5 3.5 5 7l3.5-3.5H1.5Z" />
          </svg>
        </button>
        {kindsOpen ? (
          <div className="vidi6-kind-menu" data-vidi6="shape-kinds" role="menu" aria-label="Shape kind">
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="vidi6-kind"
                data-vidi6="shape-kind"
                data-kind={kind}
                role="menuitemradio"
                aria-checked={kind === shapeKind}
                aria-label={KIND_LABEL[kind]}
                onClick={() => chooseKind(kind)}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <ShapeKindIcon kind={kind} />
                </svg>
                {KIND_LABEL[kind]}
              </button>
            ))}
          </div>
        ) : null}
      </span>

      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-connector"
        aria-label="Connector (L)"
        aria-pressed={props.tool === 'connector'}
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Connector – drag from one object to another (L)'}
        onClick={onConnectorTool}
      >
        {/* A line with an arrowhead between two dots: this tool joins things. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M5.2 9.1h5.9l-1.6-1.6 1.4-1.4L15 9.1l-4.1 4-1.4-1.4 1.6-1.6H5.2v-1ZM2.6 13.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Zm12.1-8.1a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"
          />
        </svg>
      </button>

      <button
        type="button"
        className="vidi6-tool"
        data-vidi6="tool-pen"
        aria-label="Pen (P)"
        aria-pressed={props.tool === 'pen'}
        aria-disabled={disabled}
        disabled={disabled}
        title={disabled ? 'This board could not be loaded' : 'Pen \u2013 drag to draw a line; it stays in hand (P)'}
        onClick={onPenTool}
      >
        {/* A nib with a mark under it: this tool leaves a line wherever it goes. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M13.6 2.3 17.7 6.4 8.9 15.2l-5 1.1 1.1-5 8.6-9Zm-1.2 3.5L5.6 12.6l-.4 1.9 1.9-.4 6.8-6.8-1.5-1.5Z"
          />
          <path
            fill="currentColor"
            opacity="0.55"
            d="M3 18c2.2 0 2.2-1.6 4.4-1.6 1.3 0 1.9.8 1.9.8h1.4S10 16 8.6 16C6.4 16 6.2 18 3 18Z"
          />
        </svg>
      </button>

      {/* Undo and redo sit with the tools: they act on the board the same way the tools
          do, and their enabled state is the only signal of what this client can reverse. */}
      {undo ? <UndoButtons undo={undo} /> : null}
    </div>
  );
}
