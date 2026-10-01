import type { MouseEvent as ReactMouseEvent } from 'react';
import { useState } from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { ToolId } from '../tools/useActiveTool';
import type { ShapeKind } from '../../shared/config';

export interface ToolbarProps {
  tool: ToolId | Tool;
  onToolChange(tool: ToolId): void;
  canEdit: boolean;
  onCreateSticky(): void;
  undo: UseUndoResult;
  shapeKind?: ShapeKind;
  onShapeKindChange?(kind: ShapeKind): void;
}

/**
 * The fixed left-side tool palette: Select, Text, Shape, Connector, Sticky note buttons, plus Undo/Redo.
 */
export function Toolbar({
  tool,
  onToolChange,
  canEdit,
  onCreateSticky,
  undo,
  shapeKind = 'rect',
  onShapeKindChange,
}: ToolbarProps): React.JSX.Element {
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select tool"
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onToolChange('select');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 2l10 8-4.5 1L13 16l-2 1-3.5-5L4 14V2Z" />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text tool"
        disabled={!canEdit}
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onToolChange('text');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 4h12v3h-1.5V5.5h-4V15H12v1.5H8V15h1.5V5.5h-4V7H4V4Z" />
        </svg>
      </button>
      {/* Shape button with kind menu */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="board-toolbar-button"
          data-testid="tool-shape"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          title="Shape tool"
          disabled={!canEdit}
          onClick={(event: ReactMouseEvent) => {
            event.stopPropagation();
            onToolChange('shape');
            setShapeMenuOpen(true);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="14" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {shapeMenuOpen && tool === 'shape' && (
          <div
            data-testid="shape-kind-menu"
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              marginLeft: 4,
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 100,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {(['rect', 'ellipse', 'diamond'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`shape-kind-${kind}`}
                aria-pressed={shapeKind === kind}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  background: shapeKind === kind ? '#e3f2fd' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onShapeKindChange?.(kind);
                  setShapeMenuOpen(false);
                }}
              >
                {kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Diamond'}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Connector button */}
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector tool"
        disabled={!canEdit}
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onToolChange('connector');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 17L17 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M17 3l-4 1 1-4z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={(event: ReactMouseEvent) => {
          event.stopPropagation();
          onCreateSticky();
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path fill="#FFF59D" stroke="#c9b458" d="M3 3h14v10l-4 4H3V3Z" />
          <path fill="#e6d488" d="M13 17v-4h4l-4 4Z" />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
