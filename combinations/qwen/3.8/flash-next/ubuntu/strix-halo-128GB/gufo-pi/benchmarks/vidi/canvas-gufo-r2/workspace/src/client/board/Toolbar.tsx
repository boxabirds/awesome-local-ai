import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { ToolId } from '../tools/useActiveTool';
import type { ShapeKind } from '../../shared/config';

/**
 * Left-side vertical toolbar with tool buttons, Sticky note button, Shape menu, Connector button, and Undo/Redo buttons.
 */
export function Toolbar(props: {
  tool: ToolId;
  onToolChange(t: ToolId): void;
  onCreateSticky(): void;
  shapeKind: ShapeKind;
  onShapeKindChange(k: ShapeKind): void;
  /** Opens the system file picker; adds images without changing the tool. */
  onPickImages?(): void;
  disabled?: boolean;
  undoState?: UseUndoResult;
}): JSX.Element {
  return (
    <div className="toolbar" data-testid="toolbar">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Select (V)"
        title="Select tool – or press V"
        aria-pressed={props.tool === 'select'}
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onToolChange('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 2l12 9-5 1-2 5-5-15z" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Text (T)"
        title="Text tool – or press T"
        aria-pressed={props.tool === 'text'}
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onToolChange('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <text x="4" y="15" fontSize="14" fontFamily="sans-serif" fill="currentColor">T</text>
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Sticky note"
        title="Sticky note – or press N"
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="2" fill="#FFF59D" stroke="#c8cdd4" strokeWidth="1" />
          <line x1="5" y1="7" x2="15" y2="7" stroke="#8a8a5c" strokeWidth="1.5" />
          <line x1="5" y1="11" x2="12" y2="11" stroke="#8a8a5c" strokeWidth="1.5" />
        </svg>
      </button>
      <div className="shape-tool-group" style={{ position: 'relative' }}>
        <button
          type="button"
          className="toolbar-button"
          aria-label="Shape (S)"
          title="Shape tool – or press S"
          aria-pressed={props.tool === 'shape'}
          disabled={props.disabled === true}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.onToolChange('shape')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3" y="3" width="14" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {props.tool === 'shape' && (
          <div className="shape-kind-menu" data-testid="shape-kind-menu" onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Rectangle"
              aria-pressed={props.shapeKind === 'rect'}
              onClick={() => props.onShapeKindChange('rect')}
            >Rectangle</button>
            <button
              type="button"
              aria-label="Ellipse"
              aria-pressed={props.shapeKind === 'ellipse'}
              onClick={() => props.onShapeKindChange('ellipse')}
            >Ellipse</button>
            <button
              type="button"
              aria-label="Diamond"
              aria-pressed={props.shapeKind === 'diamond'}
              onClick={() => props.onShapeKindChange('diamond')}
            >Diamond</button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Connector (L)"
        title="Connector tool – or press L"
        aria-pressed={props.tool === 'connector'}
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onToolChange('connector')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <line x1="3" y1="17" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" />
          <polygon points="17,3 17,9 11,6" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Pen (P)"
        title="Pen tool – or press P"
        aria-pressed={props.tool === 'pen'}
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onToolChange('pen')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 17l2-6L14 2l4 4L9 15l-6 2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Image"
        title="Image – adds PNG, JPEG, GIF or WebP – or press I"
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onPickImages?.()}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="4" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="9" r="1.4" fill="currentColor" />
          <path d="M3 15l4.5-4.5L11 14l2.5-2 3.5 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {props.undoState && <UndoButtons {...props.undoState} />}
    </div>
  );
}
