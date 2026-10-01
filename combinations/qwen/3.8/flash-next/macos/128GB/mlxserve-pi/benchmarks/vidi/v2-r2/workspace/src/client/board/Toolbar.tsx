// The fixed tools on the left edge of the board: the four the pointer can hold, and
// the one button that makes a thing without being told where.
//
// The tool buttons are a pressed state, not a highlight: the board must always say
// which tool the next click belongs to, because a click on an empty board either
// pans it or writes an object, and the two look exactly the same until one of them
// happens. The Shape tool is the one tool with a choice to make before it is used,
// so holding it opens a small menu beside the button: the kind the next shape is
// drawn as.

import type { JSX } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import { SHAPE_KIND_NAMES } from '../../shared/objects/shape';
import { UndoButtons } from './UndoButtons';
import type { UndoActions } from './useUndo';
import type { ToolId } from '../tools/useActiveTool';
import { toolLabel } from '../tools/useActiveTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * The tool the pointer holds. Optional, because the rail is also rendered on its
   * own (a test of the rail, a story-7 board with no tools): a rail that is not
   * wired to a tool shows Select as the pressed one, which is what a board with no
   * tools is.
   */
  tool?: ToolId;
  /** A tool button. Optional for the same reason as `tool`. */
  onTool?: (tool: ToolId) => void;
  /**
   * The kind the next shape is drawn as, and the menu that picks it (story 10).
   * Optional, like the tool itself: a rail rendered on its own has no Shape tool to
   * choose a kind for. The menu is shown while the Shape tool is held.
   */
  shapeKind?: ShapeKind;
  onShapeKind?: (kind: ShapeKind) => void;
  /**
   * This person's undo/redo, shown as toolbar buttons (story 8). Left out when a
   * caller renders the bare tool rail on its own (a test); the real board always
   * passes it. The board being uneditable is folded into these actions already.
   */
  undo?: UndoActions;
  /**
   * Tools that change the board are switched off - a board the room could not read
   * takes no edits. `disabledReason` is why, and is what the button says, so the
   * person at the keyboard is told rather than left clicking a dead button.
   */
  disabled?: boolean;
  disabledReason?: string;
}

export function Toolbar({
  onCreateSticky,
  tool = 'select',
  onTool,
  shapeKind = 'rect',
  onShapeKind,
  undo,
  disabled = false,
  disabledReason,
}: ToolbarProps): JSX.Element {
  const reason = disabled ? (disabledReason ?? 'Not available right now') : undefined;
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      // Tools are UI: a press or a wheel over them belongs to the tool, so the
      // board neither pans, zooms nor clears its selection because of one.
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-tool"
        data-testid="tool-select"
        aria-label="Select (V)"
        // the pressed tool is the one the next click belongs to
        aria-pressed={tool === 'select'}
        disabled={disabled}
        title={reason ?? 'Select, move and resize – V'}
        onClick={() => {
          onTool?.('select');
        }}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M4.5 3.5l11 6.2-4.8 1.1-1.9 4.7z"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-tool"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        // a board that could not be read has no tools to hold: the button says so
        disabled={disabled}
        title={reason ?? 'Write text anywhere – T'}
        onClick={() => {
          onTool?.('text');
        }}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            d="M4.5 5.5h11M10 5.5v9.5"
          />
        </svg>
      </button>
      <span className="board-toolbar__divider" aria-hidden="true" />
      {/* The Shape tool, with the kind menu it opens by being held: which shape the
          next drag draws. The menu is next to the button, not in a dialog, because
          the choice is made on the way to drawing. */}
      <div className="board-tool__with-menu">
        <button
          type="button"
          className="board-tool"
          data-testid="tool-shape"
          aria-label={toolLabel('shape')}
          aria-pressed={tool === 'shape'}
          aria-haspopup={tool === 'shape' || undefined}
          disabled={disabled}
          title={reason ?? 'Rectangle, ellipse or diamond – S, then drag'}
          onClick={() => {
            onTool?.('shape');
          }}
        >
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
            <rect
              x="3.5"
              y="3.5"
              width="13"
              height="13"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </button>
        {tool === 'shape' ? (
          <div
            className="tool-kind-menu"
            data-testid="shape-kind-menu"
            role="menu"
            aria-label="Shape kind"
          >
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="tool-kind-menu__option"
                data-testid={`shape-kind-${kind}`}
                role="menuitemradio"
                aria-checked={shapeKind === kind}
                title={`${SHAPE_KIND_NAMES[kind]} – the next shape is drawn as this`}
                onClick={() => {
                  onShapeKind?.(kind);
                }}
              >
                {SHAPE_KIND_NAMES[kind]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="board-tool"
        data-testid="tool-connector"
        aria-label={toolLabel('connector')}
        aria-pressed={tool === 'connector'}
        disabled={disabled}
        title={reason ?? 'Arrow between two objects – L, then drag from one to the other'}
        onClick={() => {
          onTool?.('connector');
        }}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            d="M4 15.5L14 5.5"
          />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5.5h5.5V11"
          />
          <circle cx="4" cy="15.5" r="1.6" fill="currentColor" />
        </svg>
      </button>
      <span className="board-toolbar__divider" aria-hidden="true" />
      {/* The Pen tool (story 11): press and drag and a line is drawn, in the colour
          and at the thickness the panel beside the rail offers. It is the one tool
          that keeps itself held after it has drawn - drawing the next line is what a
          person holding a pen does next - so the thing to say here is that the drag
          draws, rather than that a click places. */}
      <button
        type="button"
        className="board-tool"
        data-testid="tool-pen"
        aria-label={toolLabel('pen')}
        aria-pressed={tool === 'pen'}
        disabled={disabled}
        title={reason ?? 'Freehand drawing – P, then drag'}
        onClick={() => {
          onTool?.('pen');
        }}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M4 16l1-3.4 7.2-7.2 2.4 2.4L7.4 15z"
          />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M12.2 5.4l1.3-1.3a1.2 1.2 0 0 1 1.7 0l1.4 1.4a1.2 1.2 0 0 1 0 1.7l-1.3 1.3"
          />
        </svg>
      </button>
      <span className="board-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="board-tool"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={
          disabled
            ? (reason ?? 'Not available right now')
            : 'Sticky note – N, or double-click the board'
        }
        onClick={onCreateSticky}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            d="M3.5 3.5h13v9l-4.5 4.5h-8.5z"
          />
          <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" d="M16.5 12.5h-4.5v4.5" />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            d="M6.5 7.5h7M6.5 10.5h4"
          />
        </svg>
      </button>
      {undo === undefined ? null : (
        <>
          <span className="board-toolbar__divider" aria-hidden="true" />
          <UndoButtons {...undo} />
        </>
      )}
    </div>
  );
}
