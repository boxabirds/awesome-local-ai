import { useCallback } from 'react';
import { UndoButtons } from './UndoButtons';
import type { ToolId } from '../tools/useActiveTool';
import type { UndoState } from './useUndo';
import { SHAPE_KINDS, SHAPE_KIND_LABELS, type ShapeKind } from '../../shared/config';

/**
 * The fixed left toolbar (anchors `sticky.toolbar`, `undo.controls`,
 * `text.tool_ui`). Its tools are the two board tools - Select and Text - the
 * sticky note button, which creates a note at the centre of the visible board, and
 * the two buttons that take a person's own changes back and forward again.
 *
 * The tool buttons show which tool this client is holding (`aria-pressed`), and each
 * label names the keyboard shortcut that does the same thing: V, T, N, S, L, P. Text,
 * Shape, Connector and Pen are disabled on a board this client may not edit (TC-15).
 *
 * Story 10 adds the Shape button - which opens a kind menu while it is the active
 * tool, because the kind is chosen *before* drawing, not on the shape afterwards -
 * and the Connector button. Both are the same buttons the single-letter shortcuts
 * press, and both do nothing but ask `useActiveTool` for a tool (`tool.shortcuts`).
 *
 * Story 11 adds the Pen button. It is only a way to hold the pen - the pen's own
 * colour and thickness live in `PenToolbar`, beside the board, because they are
 * settings for the *next* stroke rather than a choice about an object that exists.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
  /** The tool this client is holding (`text.tool_ui`, `tool.shortcuts`). */
  tool?: ToolId;
  onSelectTool?(tool: ToolId): void;
  /** Which shape the Shape tool will draw (`shape.kind`). */
  shapeKind?: ShapeKind;
  onShapeKind?(kind: ShapeKind): void;
  /** True while the room could not load the board (`persist.client_status`). */
  disabled?: boolean;
  /** Undo and redo for this board (`undo.controls`). */
  undo?: UndoState;
}

export function Toolbar(props: ToolbarProps) {
  const {
    onCreateSticky,
    tool = 'select',
    onSelectTool,
    shapeKind = SHAPE_KINDS[0],
    onShapeKind,
    disabled = false,
    undo,
  } = props;

  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const pickTool = (next: ToolId): void => {
    if (disabled) {
      return;
    }
    onSelectTool?.(next);
  };

  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      data-board-chrome="true"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      <button
        type="button"
        className={`toolbar__button${tool === 'select' ? ' toolbar__button--active' : ''}`}
        data-testid="select-tool"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => pickTool('select')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M6 3l12 8-6 1.5L14 19l-2.5 1-2-6.5L6 17z" fill="currentColor" />
        </svg>
        <span className="toolbar__label">Select</span>
      </button>
      <button
        type="button"
        className={`toolbar__button${tool === 'text' ? ' toolbar__button--active' : ''}`}
        data-testid="text-tool"
        aria-label="Text (T)"
        title="Text (T) – then click the board where the text goes"
        disabled={disabled}
        aria-pressed={tool === 'text'}
        onClick={() => pickTool('text')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M5 5h14M12 5v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="toolbar__label">Text</span>
      </button>
      <button
        type="button"
        className={`toolbar__button${tool === 'shape' ? ' toolbar__button--active' : ''}`}
        data-testid="shape-tool"
        aria-label="Shape (S)"
        title="Shape (S) – drag a box, or click for a default one"
        disabled={disabled}
        aria-pressed={tool === 'shape'}
        onClick={() => pickTool('shape')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <rect x="3.5" y="6.5" width="17" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="toolbar__label">Shape</span>
      </button>
      {tool === 'shape' ? (
        <div className="toolbar__kinds" data-testid="shape-kinds" role="group" aria-label="Shape kind">
          {SHAPE_KINDS.map((kind: ShapeKind) => (
            <button
              key={kind}
              type="button"
              className={`toolbar__kind${shapeKind === kind ? ' toolbar__kind--active' : ''}`}
              data-testid={`shape-kind-${kind}`}
              aria-label={SHAPE_KIND_LABELS[kind]}
              title={SHAPE_KIND_LABELS[kind]}
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
        className={`toolbar__button${tool === 'connector' ? ' toolbar__button--active' : ''}`}
        data-testid="connector-tool"
        aria-label="Connector (L)"
        title="Connector (L) – drag from an object to where the arrow should end"
        disabled={disabled}
        aria-pressed={tool === 'connector'}
        onClick={() => pickTool('connector')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M4 18L18 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12.5 5.5H19v6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="toolbar__label">Connector</span>
      </button>
      <button
        type="button"
        className={`toolbar__button${tool === 'pen' ? ' toolbar__button--active' : ''}`}
        data-testid="pen-tool"
        aria-label="Pen (P)"
        title="Pen (P) – drag to draw, click for a dot; the pen stays in hand"
        disabled={disabled}
        aria-pressed={tool === 'pen'}
        onClick={() => pickTool('pen')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path
            d="M4 17c3-7 5 4 8-2s3 3 8-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="toolbar__label">Pen</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          onCreateSticky();
        }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="var(--sticky-icon, #FFF59D)" />
          <path d="M7 9h10M7 13h7" fill="none" stroke="#3d3d28" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="toolbar__label">Sticky note (N)</span>
      </button>
      {undo ? (
        <UndoButtons
          canUndo={undo.canUndo}
          canRedo={undo.canRedo}
          undo={undo.undo}
          redo={undo.redo}
        />
      ) : null}
    </div>
  );
}
