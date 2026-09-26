import { type JSX, type ReactNode } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** False while the board cannot be edited (persist.load_failure). */
  editable?: boolean;
  /** Active pointer tool (stories 9-12); Select is the default. */
  tool?: ToolId;
  onSelectTool?(tool: ToolId): void;
  /** Which kind of shape the Shape tool draws (`shape.kinds`). */
  shapeKind?: ShapeKind;
  onShapeKind?(kind: ShapeKind): void;
  /** Undo/Redo buttons rendered below the tools. */
  undoButtons?: ReactNode;
}

/** The Shape menu's labels, in `SHAPE_KINDS` order. */
const KIND_LABEL: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * Fixed left-side toolbar: Select, Text, Shape (with its kind menu), Connector,
 * the Sticky note button and undo/redo.
 */
export function Toolbar({
  onCreateSticky,
  editable = true,
  tool = 'select',
  onSelectTool,
  shapeKind = 'rect',
  onShapeKind,
  undoButtons,
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select"
        data-testid="tool-select"
        title="Select – or press V"
        onClick={() => onSelectTool?.('select')}
        aria-pressed={tool === 'select'}
      >
        <span aria-hidden="true">&#x2191;</span>
      </button>
      <button
        type="button"
        aria-label="Text"
        data-testid="tool-text"
        title="Text – or press T"
        onClick={() => onSelectTool?.('text')}
        disabled={!editable}
        aria-disabled={!editable}
        aria-pressed={tool === 'text'}
      >
        <span aria-hidden="true">T</span>
      </button>
      <div className="board-toolbar-shape-group">
        <button
          type="button"
          aria-label="Shape"
          data-testid="tool-shape"
          title="Shape – or press S"
          onClick={() => onSelectTool?.('shape')}
          disabled={!editable}
          aria-disabled={!editable}
          aria-pressed={tool === 'shape'}
          aria-expanded={tool === 'shape'}
        >
          <span aria-hidden="true">&#x25A1;</span>
        </button>
        {tool === 'shape' && (
          <div className="shape-kind-menu" data-testid="shape-kind-menu" role="group" aria-label="Shape kind">
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`shape-kind-${kind}`}
                aria-label={KIND_LABEL[kind]}
                title={KIND_LABEL[kind]}
                aria-pressed={shapeKind === kind}
                onClick={() => onShapeKind?.(kind)}
              >
                <span aria-hidden="true">{KIND_LABEL[kind].charAt(0)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Connector"
        data-testid="tool-connector"
        title="Connector – or press L"
        onClick={() => onSelectTool?.('connector')}
        disabled={!editable}
        aria-disabled={!editable}
        aria-pressed={tool === 'connector'}
      >
        <span aria-hidden="true">&#x2192;</span>
      </button>
      <button
        type="button"
        aria-label="Pen"
        data-testid="tool-pen"
        title="Pen \u2013 or press P"
        onClick={() => onSelectTool?.('pen')}
        disabled={!editable}
        aria-disabled={!editable}
        aria-pressed={tool === 'pen'}
      >
        <span aria-hidden="true">&#x270F;&#xFE0F;</span>
      </button>
      <button
        type="button"
        aria-label="Sticky note"
        data-testid="create-sticky"
        title="Sticky note \u2013 or double-click the board"
        onClick={onCreateSticky}
        disabled={!editable}
        aria-disabled={!editable}
      >
        <span aria-hidden="true">&#x1F4CC;</span>
      </button>
      {undoButtons}
    </div>
  );
}
