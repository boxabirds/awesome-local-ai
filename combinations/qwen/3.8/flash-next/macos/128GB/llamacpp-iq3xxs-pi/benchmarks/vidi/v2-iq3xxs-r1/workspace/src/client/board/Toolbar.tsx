import { useRef, type ReactNode } from 'react';
import { useNativeStopPropagation } from './useNativeStopPropagation';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { ActiveTool } from '../tools/useActiveTool';
import { SHAPE_KIND_LABELS, SHAPE_KINDS, type ShapeKind } from '../../shared/config';

export interface ToolbarProps {
  /** Create a sticky note in the centre of the visible board area. */
  onCreateSticky(): void;
  /** False disables creation while the board cannot be edited (e.g. it failed to load). */
  disabled?: boolean;
  /** This tab's undo/redo state and actions (story 8); absent on boards without a history. */
  undo?: UndoButtonsProps;
  /**
   * The active tool (story 9, story 10). The tool buttons report it with `aria-pressed`,
   * and creating tools are unavailable on a board that cannot be edited
   * (PRD text.load_failed).
   */
  tool?: ActiveTool;
  /**
   * The pen options, shown inside the toolbar while the Pen tool is active — where the
   * shape kind menu sits for the Shape tool (PRD pen.options).
   */
  penOptions?: ReactNode;
}

export const STICKY_BUTTON_LABEL = 'Sticky note (N)';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';
export const SELECT_BUTTON_LABEL = 'Select (V)';
export const TEXT_BUTTON_LABEL = 'Text (T)';
export const SHAPE_BUTTON_LABEL = 'Shape (S)';
export const CONNECTOR_BUTTON_LABEL = 'Connector (L)';
export const PEN_BUTTON_LABEL = 'Pen (P)';

/**
 * Left-side vertical board toolbar: the tool the board is in, then the things a
 * person can put on the board. The Sticky note button is always available.
 */
export function Toolbar({ onCreateSticky, disabled = false, undo, tool, penOptions }: ToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);
  const isText = tool?.tool === 'text';
  const isShape = tool?.tool === 'shape';
  const isConnector = tool?.tool === 'connector';
  const isPen = tool?.tool === 'pen';

  return (
    <div ref={ref} className="board-toolbar" data-testid="board-toolbar">
      <button
        type="button"
        className="tool-button"
        data-testid="tool-select"
        aria-label={SELECT_BUTTON_LABEL}
        title={`${SELECT_BUTTON_LABEL} – move and resize what is on the board`}
        aria-pressed={tool ? tool.tool === 'select' : undefined}
        onClick={tool ? () => tool.setTool('select') : undefined}
      >
        <span className="tool-icon" aria-hidden="true">
          {'\u2196'}
        </span>
        Select
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="tool-text"
        aria-label={TEXT_BUTTON_LABEL}
        title={`${TEXT_BUTTON_LABEL} – write anywhere on the board`}
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool ? isText : undefined}
        onClick={disabled || !tool ? undefined : () => tool.setTool('text')}
      >
        <span className="tool-icon tool-icon-text" aria-hidden="true">
          T
        </span>
        Text
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="tool-shape"
        aria-label={SHAPE_BUTTON_LABEL}
        title={`${SHAPE_BUTTON_LABEL} – draw a rectangle, ellipse or diamond`}
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool ? isShape : undefined}
        onClick={disabled || !tool ? undefined : () => tool.setTool('shape')}
      >
        <span className="tool-icon tool-icon-shape" aria-hidden="true">
          {'\u25AF'}
        </span>
        Shape
      </button>
      {/* Which shape the Shape tool draws next; shown while the tool is active
          (PRD shape.create_click). Picking a kind does not leave the tool. */}
      {isShape && tool ? (
        <div
          className="shape-kind-menu"
          data-testid="shape-kind-menu"
          role="group"
          aria-label="Shape kind"
        >
          {SHAPE_KINDS.map((kind: ShapeKind) => (
            <button
              key={kind}
              type="button"
              className="tool-button shape-kind-button"
              data-testid={`tool-shape-kind-${kind}`}
              data-shape-kind={kind}
              aria-pressed={tool.shapeKind === kind}
              onClick={() => tool.setShapeKind(kind)}
            >
              {SHAPE_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="tool-button"
        data-testid="tool-connector"
        aria-label={CONNECTOR_BUTTON_LABEL}
        title={`${CONNECTOR_BUTTON_LABEL} – draw an arrow between things`}
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool ? isConnector : undefined}
        onClick={disabled || !tool ? undefined : () => tool.setTool('connector')}
      >
        <span className="tool-icon tool-icon-connector" aria-hidden="true">
          {'\u2192'}
        </span>
        Connector
      </button>
      {/* The Pen is the one tool that stays put: drawing one stroke does not send you
          back to Select, because sketching is more than one stroke (PRD pen.stay_active). */}
      <button
        type="button"
        className="tool-button"
        data-testid="tool-pen"
        aria-label={PEN_BUTTON_LABEL}
        title={`${PEN_BUTTON_LABEL} – draw freehand on the board`}
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool ? isPen : undefined}
        onClick={disabled || !tool ? undefined : () => tool.setTool('pen')}
      >
        <span className="tool-icon tool-icon-pen" aria-hidden="true">
          {'\u270E'}
        </span>
        Pen
      </button>
      {penOptions}
      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onCreateSticky}
      >
        <span className="tool-icon" aria-hidden="true">
          {'\u{1F4CC}'}
        </span>
        Sticky note
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
