import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Story 8: the undo/redo controls shown under the tools. */
  undo: UndoState;
  /** Story 9: the tool this page is holding, and the buttons that pick it. */
  tool?: ToolId;
  onTool?(tool: ToolId): void;
  /** Story 10: which shape the Shape tool will draw next, and the menu that picks it. */
  shapeKind?: ShapeKind;
  onShapeKind?(kind: ShapeKind): void;
  /**
   * True while this page must not be adding to the board — story 4 sets it when the
   * room could not load the board, because a note created on top of a board that
   * never arrived would be a note nobody else can see.
   */
  createDisabled?: boolean;
}

/** Exact tooltip shown on the Sticky note button (PRD wording). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';
/** Exact tooltip shown on the Select tool button. */
export const SELECT_TOOL_TOOLTIP = 'Select – or press V';
/** Exact tooltip shown on the Text tool button. */
export const TEXT_TOOL_TOOLTIP = 'Text – or press T, then click the board';
/** Exact tooltip shown on the Shape tool button. */
export const SHAPE_TOOL_TOOLTIP = 'Shape – or press S, then drag on the board';
/** Exact tooltip shown on the Connector tool button. */
export const CONNECTOR_TOOL_TOOLTIP = 'Connector – or press L, then drag between two objects';

/** What each shape kind is called, in the menu and on the button. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** The little outline of each kind, inside its button in the shape menu. */
function KindIcon({ kind }: { kind: ShapeKind }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === 'rect' ? (
        <rect x="2.5" y="4.5" width="11" height="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : null}
      {kind === 'ellipse' ? (
        <ellipse cx="8" cy="8" rx="5.5" ry="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : null}
      {kind === 'diamond' ? (
        <polygon points="8,2.5 13.5,8 8,13.5 2.5,8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : null}
    </svg>
  );
}

/**
 * The fixed left-side tool rail: which tool this page is holding (story 9), the
 * sticky note creation button (story 2) and the undo controls (story 8).
 *
 * The two tool buttons are a set: exactly one is pressed, and the Text button
 * carries `aria-disabled` *and* `disabled` semantics through `disabled`, because a
 * board that failed to load must not be given a tool that would write to it
 * (PRD text.not_editable).
 */
export function Toolbar({
  onCreateSticky,
  createDisabled = false,
  undo,
  tool = 'select',
  onTool,
  shapeKind = 'rect',
  onShapeKind,
}: ToolbarProps) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div
      className="toolbar"
      data-testid="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar__button"
        aria-label="Select (V)"
        title={SELECT_TOOL_TOOLTIP}
        data-testid="select-tool-button"
        aria-pressed={tool === 'select'}
        onClick={() => onTool?.('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M5 3l11 6-4.6 1.4L9 17 5 3Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Text (T)"
        title={TEXT_TOOL_TOOLTIP}
        data-testid="text-tool-button"
        aria-pressed={tool === 'text'}
        disabled={createDisabled}
        onClick={() => onTool?.('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 4h12v3h-1.6V6.6H11.3V14h1.9v1.6H6.8V14h1.9V6.6H5.6V7H4V4Z"
          />
        </svg>
      </button>
      {/* Story 10: the two new tools, and the kind menu that belongs to the Shape one.
          The three kinds are a set with exactly one pressed, like the tools themselves;
          picking a kind does not change which tool is held. */}
      <div className="toolbar__group" data-testid="shape-tool-group">
        <button
          type="button"
          className="toolbar__button"
          aria-label="Shape (S)"
          title={SHAPE_TOOL_TOOLTIP}
          data-testid="shape-tool-button"
          aria-pressed={tool === 'shape'}
          disabled={createDisabled}
          onClick={() => onTool?.('shape')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <rect
              x="3.5"
              y="5.5"
              width="13"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        </button>
        <div className="toolbar__kinds" role="group" aria-label="Shape kind">
          {SHAPE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="toolbar__kind"
              aria-label={SHAPE_KIND_LABELS[kind]}
              title={SHAPE_KIND_LABELS[kind]}
              data-testid={`shape-kind-${kind}`}
              aria-pressed={shapeKind === kind}
              disabled={createDisabled}
              onClick={() => onShapeKind?.(kind)}
            >
              <KindIcon kind={kind} />
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Connector (L)"
        title={CONNECTOR_TOOL_TOOLTIP}
        data-testid="connector-tool-button"
        aria-pressed={tool === 'connector'}
        disabled={createDisabled}
        onClick={() => onTool?.('connector')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 15.5L14.5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path d="M9.5 4.5h6v6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="4" cy="15.5" r="2" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        data-testid="sticky-note-button"
        disabled={createDisabled}
        onClick={onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 3h9l4 4v10H4V3Zm8 0v5h5M6 9h8M6 12h8M6 15h5"
            stroke="currentColor"
            strokeWidth="1.3"
            fillOpacity="0.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
