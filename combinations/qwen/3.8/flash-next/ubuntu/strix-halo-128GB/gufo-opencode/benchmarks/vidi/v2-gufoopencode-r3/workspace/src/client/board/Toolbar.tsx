import type { JSX } from 'react';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  // Story 12: opens the system file picker; not a persistent tool.
  onPickImages(): void;
  tool: ToolId;
  onSelectTool(tool: ToolId): void;
  shapeKind: ShapeKind;
  onSelectShapeKind(kind: ShapeKind): void;
  // Disabled while the board cannot be loaded (load_failed), TC-23.
  disabled?: boolean;
  undo: UndoState;
}

const KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond'
};

// Fixed left-side vertical toolbar.
export function Toolbar({
  onCreateSticky,
  onPickImages,
  tool,
  onSelectTool,
  shapeKind,
  onSelectShapeKind,
  disabled = false,
  undo
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – or press V"
        onClick={() => onSelectTool('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M5 2l11 8-5 1 3 6-2.5 1-3-6-3.5 3z" fill="#fff" stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – or press T, then click the board"
        onClick={() => onSelectTool('text')}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 4h14M10 4v13" fill="none" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <div className="shape-tool-button">
        <button
          type="button"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          title="Shape – or press S, then drag on the board"
          onClick={() => onSelectTool('shape')}
          disabled={disabled}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <rect x="2.5" y="2.5" width="15" height="15" rx="1.5" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
          </svg>
        </button>
        {tool === 'shape' && (
          <div className="shape-kind-menu" role="group" aria-label="Shape kind">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="shape-kind-option"
                aria-label={KIND_LABELS[k]}
                aria-pressed={k === shapeKind}
                onClick={() => {
                  onSelectShapeKind(k);
                }}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector – or press L, then drag between objects"
        onClick={() => onSelectTool('connector')}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 17L15 5M15 5h-5M15 5v5" fill="none" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Pen (P)"
        aria-pressed={tool === 'pen'}
        title="Pen – or press P, then draw on the board"
        onClick={() => onSelectTool('pen')}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 17l1-4L14 3l3 3L7 16l-4 1z" fill="#fff" stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M12 5l3 3" fill="none" stroke="#0f172a" strokeWidth="1.5" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Image (I)"
        title="Image – or press I, to add images in the middle of the view"
        onClick={onPickImages}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="#fff" stroke="#0f172a" strokeWidth="1.5" />
          <circle cx="7" cy="8" r="1.5" fill="#0f172a" />
          <path d="M4 14.5l4-4 3 3 2.5-2.5 2.5 3" fill="none" stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note – or press N, or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="2" y="2" width="16" height="16" rx="2" fill={STICKY_COLORS[DEFAULT_STICKY_COLOR]} stroke="#0f172a" strokeWidth="1.5" />
          <path d="M12 18V14a2 2 0 0 1 2-2h4" fill="none" stroke="#0f172a" strokeWidth="1.5" />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
