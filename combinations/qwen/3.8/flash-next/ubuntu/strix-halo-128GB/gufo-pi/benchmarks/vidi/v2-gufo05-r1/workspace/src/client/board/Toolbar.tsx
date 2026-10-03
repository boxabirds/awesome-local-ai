/**
 * The left-hand toolbar: the tools, and under them this person's Undo and Redo.
 *
 * Two kinds of control live here, and the difference is what a click on the board
 * does afterwards:
 *
 * - **Modes** — Select, Text, Shape and Connector (`text.tool_ui`, `shape.tool`,
 *   `connector.tool`). One is always armed (`aria-pressed`), and arming one changes what
 *   the next click means without changing anything on the board. `V`, `T`, `S` and `L`
 *   are the same choices; the shortcut is in the label so a person can read it off the
 *   button.
 * - **Actions** — Sticky note, which puts a note in the middle of the visible board and
 *   puts its text straight into edit mode (`N` does the same thing), and the undo pair,
 *   which steps back over what the tools did.
 *
 * The Shape tool carries a second choice — which shape the next drag draws — shown as a
 * small menu of kinds under its button while it is armed (`shape.tool`).
 *
 * Text, Shape and Connector are disabled when the board cannot be written: offering a
 * mode whose clicks go nowhere is worse than saying the board cannot be edited.
 *
 * It is a fixed overlay outside the world layer, so it does not pan or zoom and stays
 * reachable at any zoom level.
 */
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { UndoHandle } from './useUndo';

/** The Shape-menu label for a kind. */
const KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Which mode a click on the board is in. Defaults to Select for a caller with no modes. */
  tool?: ToolId;
  /** False on a board that cannot be written: Text, Shape and Connector are disabled. */
  canEdit?: boolean;
  /** Arm a mode. Absent means the toolbar has no modes to offer. */
  onTool?(tool: ToolId): void;
  /** The kind the Shape tool will draw next. */
  shapeKind?: ShapeKind;
  /** Choose the kind the Shape tool will draw next. */
  onShapeKind?(kind: ShapeKind): void;
  /** This person's history, for the buttons underneath the tools. */
  undo: UndoHandle;
}

export function Toolbar({
  onCreateSticky,
  tool = 'select',
  canEdit = true,
  onTool,
  shapeKind = 'rect',
  onShapeKind,
  undo,
}: ToolbarProps) {
  return (
    <div className="toolbar" data-testid="toolbar" role="toolbar" aria-label="Board tools">
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select — drag to move objects, click empty board to clear the selection"
        onClick={() => {
          onTool?.('select');
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 2.5l8 4.2-3.4 1.1-1.2 3.5L4 2.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span>Select</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={!canEdit}
        title="Text — click anywhere on the board to write there"
        onClick={() => {
          onTool?.('text');
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4V2.5h10V4M8 2.5V13M6 13h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <span>Text</span>
      </button>
      <div className="toolbar__shape">
        <button
          type="button"
          className="toolbar__button"
          data-testid="tool-shape"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          disabled={!canEdit}
          title="Shape — drag a box, or click for a standard one"
          onClick={() => {
            onTool?.('shape');
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect
              x="2.5"
              y="4.5"
              width="11"
              height="7"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          <span>Shape</span>
        </button>
        {tool === 'shape' ? (
          <div className="toolbar__kinds" data-testid="shape-kind-menu" role="group" aria-label="Shape kind">
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="toolbar__kind"
                data-testid={`shape-kind-${kind}`}
                aria-label={KIND_LABELS[kind]}
                aria-pressed={kind === shapeKind}
                title={KIND_LABELS[kind]}
                onClick={() => {
                  onShapeKind?.(kind);
                }}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        disabled={!canEdit}
        title="Connector — drag from one object to another"
        onClick={() => {
          onTool?.('connector');
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 13L13 3M13 3H8M13 3v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Connector</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-sticky-note"
        aria-label="Sticky note (N)"
        title="Sticky note — adds a note in the centre and starts typing"
        onClick={onCreateSticky}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 3h10v7l-3 3H3V3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M13 10h-3v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span>Sticky note</span>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
