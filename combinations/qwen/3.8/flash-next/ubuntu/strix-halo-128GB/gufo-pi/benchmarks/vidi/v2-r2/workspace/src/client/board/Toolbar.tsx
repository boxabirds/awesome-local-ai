import type { ReactElement } from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';
import type { ShapeKind } from '@shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoButtonsProps;
  tool?: Tool;
  onToolChange?(t: Tool): void;
  shapeKind?: ShapeKind;
  onShapeKindChange?(k: ShapeKind): void;
  onShapeToolClick?(): void;
  onConnectorToolClick?(): void;
}

export function Toolbar({
  onCreateSticky,
  disabled = false,
  undo,
  tool = 'select',
  onToolChange,
  shapeKind = 'rect',
  onShapeKindChange,
  onShapeToolClick,
  onConnectorToolClick,
}: ToolbarProps): ReactElement {
  return (
    <div
      className="board-toolbar"
      data-board-ui="true"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – V"
        className={`board-toolbar-btn${tool === 'select' ? ' board-toolbar-btn--active' : ''}`}
        onClick={() => onToolChange?.('select')}
        data-testid="select-tool-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 2l12 8-5.5 1.5L14 17l-2.5 1-3.5-5.5L4 16V2z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – T"
        className={`board-toolbar-btn${tool === 'text' ? ' board-toolbar-btn--active' : ''}`}
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
        data-testid="text-tool-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 4h12M10 4v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        className="board-toolbar-btn"
        onClick={onCreateSticky}
        disabled={disabled}
        data-testid="sticky-note-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="2" fill="#FFF59D" stroke="#999" strokeWidth="1" />
          <line x1="6" y1="7" x2="14" y2="7" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="11" x2="12" y2="11" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {/* Shape button with kind menu */}
      <button
        aria-label="Shape (S)"
        aria-pressed={tool === 'shape'}
        title="Shape – S"
        className={`board-toolbar-btn${tool === 'shape' ? ' board-toolbar-btn--active' : ''}`}
        onClick={onShapeToolClick}
        disabled={disabled}
        data-testid="shape-tool-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {/* Connector button */}
      <button
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector – L"
        className={`board-toolbar-btn${tool === 'connector' ? ' board-toolbar-btn--active' : ''}`}
        onClick={onConnectorToolClick}
        disabled={disabled}
        data-testid="connector-tool-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <line x1="4" y1="16" x2="16" y2="4" stroke="currentColor" strokeWidth="1.5" />
          <polygon points="16,4 11,5 15,9" fill="currentColor" />
        </svg>
      </button>
      {undo && <UndoButtons {...undo} />}
      {/* Shape kind menu (shown when shape tool is active) */}
      {tool === 'shape' && onShapeKindChange && (
        <div
          data-testid="shape-kind-menu"
          style={{ position: 'absolute', left: '100%', top: 0, marginLeft: 4, background: '#fff', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', padding: 4, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 10 }}
        >
          <button
            aria-label="Rectangle"
            aria-pressed={shapeKind === 'rect'}
            className={`board-toolbar-btn${shapeKind === 'rect' ? ' board-toolbar-btn--active' : ''}`}
            onClick={() => onShapeKindChange('rect')}
            data-testid="shape-kind-rect"
          >
            <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>
          </button>
          <button
            aria-label="Ellipse"
            aria-pressed={shapeKind === 'ellipse'}
            className={`board-toolbar-btn${shapeKind === 'ellipse' ? ' board-toolbar-btn--active' : ''}`}
            onClick={() => onShapeKindChange('ellipse')}
            data-testid="shape-kind-ellipse"
          >
            <svg width="16" height="16" viewBox="0 0 16 16"><ellipse cx="8" cy="8" rx="6" ry="5" stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>
          </button>
          <button
            aria-label="Diamond"
            aria-pressed={shapeKind === 'diamond'}
            className={`board-toolbar-btn${shapeKind === 'diamond' ? ' board-toolbar-btn--active' : ''}`}
            onClick={() => onShapeKindChange('diamond')}
            data-testid="shape-kind-diamond"
          >
            <svg width="16" height="16" viewBox="0 0 16 16"><polygon points="8,1 15,8 8,15 1,8" stroke="currentColor" fill="none" strokeWidth="1.5"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
