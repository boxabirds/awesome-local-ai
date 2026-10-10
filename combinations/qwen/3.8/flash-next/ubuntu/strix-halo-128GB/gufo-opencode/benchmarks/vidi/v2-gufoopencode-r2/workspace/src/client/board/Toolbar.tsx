// Fixed left toolbar: the story 9 Select/Text tool pair, then the Sticky
// note button (creates a note at the centre of the visible board area),
// followed by the story 8 undo/redo pair. Story 10 adds the Shape button
// (with its Rectangle/Ellipse/Diamond kind menu while active) and the
// Connector button.

import type { ShapeKind } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { ToolId } from '../tools/useActiveTool';
import type { UndoState } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoState;
  // Story 9: the active board tool (select/text) and its switcher; story 10
  // widens this to the full tool id plus the current shape kind.
  tool?: ToolId;
  onToolChange?(tool: ToolId): void;
  shapeKind?: ShapeKind;
  onShapeKind?(kind: ShapeKind): void;
}

const SHAPE_KIND_LABELS: ReadonlyArray<{ kind: ShapeKind; label: string }> = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'diamond', label: 'Diamond' },
];

export function Toolbar({
  onCreateSticky,
  disabled = false,
  undo,
  tool = 'select',
  onToolChange,
  shapeKind = 'rect',
  onShapeKind,
}: ToolbarProps): React.JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-select"
        aria-label="Select (V)"
        title="Select – or press V"
        aria-pressed={tool === 'select'}
        onClick={() => onToolChange?.('select')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M4 2.5 14.5 9l-4.7 1.1L7.5 15 4 2.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <span>Select</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-text"
        aria-label="Text (T)"
        title="Text – or press T, then click the board"
        aria-pressed={tool === 'text'}
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M3 4V2.5h12V4M9 2.5V15.5M6.5 15.5h5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Text</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note – or press N"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M2.5 2.5h13v10l-3 3h-10v-13Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M15.5 12.5h-3v3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span>Sticky note</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-shape"
        aria-label="Shape (S)"
        title="Shape – or press S, then drag or click the board"
        aria-pressed={tool === 'shape'}
        onClick={() => onToolChange?.('shape')}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect
            x="2.5"
            y="4.5"
            width="13"
            height="9"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <span>Shape</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        title="Connector – or press L, then drag between objects"
        aria-pressed={tool === 'connector'}
        onClick={() => onToolChange?.('connector')}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2.5 15.5 15.5 2.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9 2.5h6.5V9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <span>Connector</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-pen"
        aria-label="Pen (P)"
        title="Pen – or press P, then drag on the board"
        aria-pressed={tool === 'pen'}
        onClick={() => onToolChange?.('pen')}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M2.5 15.5 4 11 12.5 2.5 15.5 5.5 7 14 2.5 15.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M11 4l3 3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Pen</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
      {tool === 'shape' ? (
        <div
          className="shape-kind-menu"
          data-testid="shape-kind-menu"
          role="toolbar"
          aria-label="Shape kind"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {SHAPE_KIND_LABELS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              className="shape-kind-button"
              data-testid={`shape-kind-${kind}`}
              aria-label={label}
              title={label}
              aria-pressed={kind === shapeKind}
              onClick={() => onShapeKind?.(kind)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
