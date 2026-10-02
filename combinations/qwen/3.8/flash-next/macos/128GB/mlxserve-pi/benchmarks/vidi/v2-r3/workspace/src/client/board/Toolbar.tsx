import type { JSX, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { BoardTool } from './useTool';
import { SHAPE_KINDS, SHAPE_KIND_LABELS, type ShapeKind } from '../../shared/config';

export interface ToolbarProps {
  /** Create a note at the centre of the visible board area and edit it. */
  onCreateSticky(): void;
  /**
   * Which tool the board is in, and where a tool button puts it. Absent only when
   * a toolbar is rendered on its own, without a board behind it.
   */
  tool?: BoardTool;
  /** The board is left in Select by whatever it creates, so the only way out of
   * the Text tool is into the Select one: these two buttons are the tool. */
  onSelectTool?(tool: BoardTool): void;
  /** The kind the Shape tool will draw next, which is the kind its menu has
   * pressed. It is a state of the tool and not of the board: the board holds no
   * half-drawn shape, only the choice of what the next drag becomes.
   */
  shapeKind?: ShapeKind;
  /** Choose a kind from the Shape menu. Choosing one is also asking for it, so
   * the menu arms the tool it belongs to rather than waiting for a second press.
   */
  onSelectShapeKind?(kind: ShapeKind): void;
  /** False only while the board cannot be edited (a board that failed to
   * load): the Sticky note button is disabled, so a click creates nothing, and so
   * is the Text tool button, because a tool whose only act is to create something
   * has nothing to offer. Selecting is left alone: seeing a board is not editing.
   */
  disabled?: boolean;
  /** This person's own undo history, as the two buttons need it. Absent only
   * when a toolbar is rendered on its own, without a board behind it.
   */
  undo?: UndoButtonsProps;
}

/**
 * The left-side board toolbar: Select and Text tool buttons, the Shape tool and
 * its three kinds, the Connector tool, the Sticky note button, and under them the
 * Undo and Redo buttons of this person's own history (stories 8 and 10).
 *
 * The tool buttons change what the next pointer does on the board and nothing else
 * — not the camera, not the selection, not what is being edited — and the active
 * one is highlighted, which is the whole of a tool's interface (`aria-pressed` is
 * also how a test reads the state back). The Sticky note button is not a tool: it
 * makes a note where the board is centred, whatever tool the board is in, and
 * leaves the board back in Select.
 *
 * The Shape menu is the one place on this toolbar where a button chooses a thing
 * rather than a mode: the three kinds share one tool and one drag, and which of
 * them the drag makes is the only thing the menu remembers.
 *
 * Its accessible name and tooltip are exactly what story 2 left them: the letter
 * of its shortcut belongs in the keyboard, not in the name a person listening to
 * the toolbar hears twice.
 *
 * Pointer events are stopped here so a click on a tool never reaches the
 * viewport, which would read it as a click on empty board space and clear the
 * selection.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const stop = (e: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
    e.stopPropagation();
  };
  const tool = props.tool ?? 'select';

  const select = (next: BoardTool) => {
    props.onSelectTool?.(next);
  };

  return (
    <aside
      className="toolbar"
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar-button toolbar-select-button"
        data-testid="select-tool-button"
        aria-label="Select (V)"
        title="Select – move and resize what is already here (V)"
        aria-pressed={props.tool === undefined ? undefined : tool === 'select'}
        onClick={() => {
          select('select');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path
            d="M4 2.5l9.5 6.2-4.3.9 2.2 4.4-1.7.9-2.2-4.4-3.5 2.6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button toolbar-text-button"
        data-testid="text-tool-button"
        aria-label="Text (T)"
        title="Text – write anywhere (T)"
        aria-disabled={props.disabled ? 'true' : undefined}
        disabled={props.disabled === true}
        aria-pressed={props.tool === undefined ? undefined : tool === 'text'}
        onClick={() => {
          select('text');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path
            d="M3.5 5V3.5h11V5M9 3.5v11M6.5 14.5h5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button toolbar-shape-button"
        data-testid="shape-tool-button"
        aria-label="Shape (S)"
        title="Shape – draw a rectangle, an ellipse or a diamond (S)"
        aria-disabled={props.disabled ? 'true' : undefined}
        disabled={props.disabled === true}
        aria-pressed={props.tool === undefined ? undefined : tool === 'shape'}
        onClick={() => {
          select('shape');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <rect x="2.2" y="2.2" width="13.6" height="13.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <div className="toolbar-shape-kinds" data-testid="shape-kind-menu" role="group" aria-label="Shape kind">
        {SHAPE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`toolbar-kind-button toolbar-kind-button-${kind}`}
            data-testid={`shape-kind-${kind}`}
            aria-label={SHAPE_KIND_LABELS[kind]}
            title={`${SHAPE_KIND_LABELS[kind]} – drag the board to draw one`}
            aria-disabled={props.disabled ? 'true' : undefined}
            disabled={props.disabled === true}
            aria-pressed={props.shapeKind === undefined ? undefined : props.shapeKind === kind && tool === 'shape'}
            onClick={() => {
              props.onSelectShapeKind?.(kind);
              select('shape');
            }}
          >
            <ShapeKindIcon kind={kind} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="toolbar-button toolbar-connector-button"
        data-testid="connector-tool-button"
        aria-label="Connector (L)"
        title="Connector – drag an arrow from one shape to another (L)"
        aria-disabled={props.disabled ? 'true' : undefined}
        disabled={props.disabled === true}
        aria-pressed={props.tool === undefined ? undefined : tool === 'connector'}
        onClick={() => {
          select('connector');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path d="M2.5 15.5L13 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path
            d="M8 4.5h5.5V10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button toolbar-sticky-note-button"
        data-testid="sticky-note-button"
        aria-label="Sticky note"
        aria-disabled={props.disabled ? 'true' : undefined}
        disabled={props.disabled === true}
        title="Sticky note – or double-click the board"
        onClick={() => {
          props.onCreateSticky();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path
            d="M2.5 2.5h13v9l-4 4h-9z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M15.5 11.5h-4v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      {props.undo !== undefined ? <UndoButtons {...props.undo} /> : null}
    </aside>
  );
}

/** The three figures, drawn as the menu offers them: the same three shapes the
 *  board draws, in the same box, because a menu that showed something else would
 *  be a menu that lied about what it does. */
function ShapeKindIcon(props: { kind: ShapeKind }): JSX.Element {
  const paint = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' } as const;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      {props.kind === 'ellipse' ? <ellipse cx="9" cy="9" rx="7" ry="5.5" {...paint} /> : null}
      {props.kind === 'diamond' ? <polygon points="9,2 16,9 9,16 2,9" {...paint} /> : null}
      {props.kind === 'rect' ? <rect x="2.2" y="4.2" width="13.6" height="9.6" {...paint} /> : null}
    </svg>
  );
}
