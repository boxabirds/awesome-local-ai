import type { JSX } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';
import type { ToolId } from '../tools/useActiveTool';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';

/** Board tools: select (default), text, shape and connector (story 10). */
export type BoardTool = ToolId;

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Activate the text tool (T). */
  onToolText?(): void;
  /** Activate the select tool (V / Escape). */
  onToolSelect?(): void;
  /** Activate the shape tool (S, story 10). */
  onToolShape?(): void;
  /** Activate the connector tool (L, story 10). */
  onToolConnector?(): void;
  /** The currently active tool (for the pressed state). */
  activeTool?: BoardTool;
  /** The shape kind used by the shape tool (story 10). */
  shapeKind?: ShapeKind;
  /** Change the shape kind (story 10). */
  onShapeKind?(kind: ShapeKind): void;
  /** When true the buttons are inert (the board is not editable, e.g. load failed). */
  disabled?: boolean;
  /** Undo/redo state and actions (story 8). */
  undo?: Pick<UseUndoResult, 'canUndo' | 'canRedo' | 'undo' | 'redo'>;
}

const SHAPE_KINDS: { kind: ShapeKind; label: string; icon: string }[] = [
  { kind: 'rect', label: 'Rectangle', icon: '▭' },
  { kind: 'ellipse', label: 'Ellipse', icon: '◯' },
  { kind: 'diamond', label: 'Diamond', icon: '◇' },
];

/**
 * Fixed left-side vertical toolbar with a Sticky note button, a Text tool
 * button (story 9), Shape and Connector tool buttons (story 10) and undo/redo.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const activeTool = props.activeTool ?? 'select';
  const shapeKind = props.shapeKind ?? 'rect';
  return (
    <div
      className="board-toolbar"
      data-vidi6="board-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`board-toolbar-select${activeTool === 'select' ? ' board-toolbar-select--active' : ''}`}
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={activeTool === 'select'}
        disabled={props.disabled}
        onClick={() => props.onToolSelect?.()}
      >
        <span className="board-toolbar-select-icon" aria-hidden="true">⬚</span>
        <span className="board-toolbar-select-label">Select</span>
      </button>
      <button
        type="button"
        className="board-toolbar-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <span className="board-toolbar-sticky-icon" aria-hidden="true">📝</span>
        <span className="board-toolbar-sticky-label">Sticky note</span>
      </button>
      <button
        type="button"
        className={`board-toolbar-text${activeTool === 'text' ? ' board-toolbar-text--active' : ''}`}
        aria-label="Text (T)"
        title="Text – press T, then click anywhere on the board"
        aria-pressed={activeTool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onToolText?.()}
      >
        <span className="board-toolbar-text-icon" aria-hidden="true">T</span>
        <span className="board-toolbar-text-label">Text</span>
      </button>
      <button
        type="button"
        className={`board-toolbar-shape${activeTool === 'shape' ? ' board-toolbar-shape--active' : ''}`}
        aria-label="Shape (S)"
        title="Shape – press S, then drag on the board"
        aria-pressed={activeTool === 'shape'}
        disabled={props.disabled}
        data-vidi6="toolbar-shape"
        onClick={() => props.onToolShape?.()}
      >
        <span className="board-toolbar-shape-icon" aria-hidden="true">▭</span>
        <span className="board-toolbar-shape-label">Shape</span>
      </button>
      <button
        type="button"
        className={`board-toolbar-connector${activeTool === 'connector' ? ' board-toolbar-connector--active' : ''}`}
        aria-label="Connector (L)"
        title="Connector – press L, then drag from one object to another"
        aria-pressed={activeTool === 'connector'}
        disabled={props.disabled}
        data-vidi6="toolbar-connector"
        onClick={() => props.onToolConnector?.()}
      >
        <span className="board-toolbar-connector-icon" aria-hidden="true">↝</span>
        <span className="board-toolbar-connector-label">Connector</span>
      </button>
      {activeTool === 'shape' && (
        <div
          className="board-toolbar-kind"
          data-vidi6="shape-kind-picker"
          role="group"
          aria-label="Shape kind"
        >
          {SHAPE_KINDS.map(({ kind, label, icon }) => (
            <button
              key={kind}
              type="button"
              className={`board-toolbar-kind-btn${shapeKind === kind ? ' board-toolbar-kind-btn--active' : ''}`}
              data-vidi6={`shape-kind-${kind}`}
              aria-label={`${label} shape`}
              aria-pressed={shapeKind === kind}
              title={label}
              disabled={props.disabled}
              onClick={() => props.onShapeKind?.(kind)}
            >
              <span aria-hidden="true">{icon}</span>
            </button>
          ))}
        </div>
      )}
      {props.undo && <UndoButtons undo={props.undo} />}
    </div>
  );
}
