import type { ReactElement } from 'react';
import type { Tool } from './useTool';
import type { ToolId } from '../tools/useActiveTool';
import type { ShapeKind } from '../../shared/config';

interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  tool?: Tool;
  onToolChange?: (t: Tool) => void;
  // Story 10: extended tool support
  activeToolId?: ToolId;
  onActiveToolChange?: (t: ToolId) => void;
  shapeKind?: ShapeKind;
  onShapeKindChange?: (k: ShapeKind) => void;
}

const buttonStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  fontSize: 18,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#dbeafe',
  borderColor: '#3b82f6',
};

export function Toolbar({
  onCreateSticky,
  disabled = false,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  tool = 'select',
  onToolChange,
  activeToolId,
  onActiveToolChange,
  shapeKind = 'rect',
  onShapeKindChange,
}: ToolbarProps): ReactElement {
  // Use the extended tool system if available
  const currentTool = activeToolId ?? tool;
  const handleToolChange = (t: ToolId) => {
    onActiveToolChange?.(t);
    if (t === 'select' || t === 'text') {
      onToolChange?.(t as Tool);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Board tools"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        gap: 8,
        padding: 8,
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={currentTool === 'select'}
        style={currentTool === 'select' ? activeButtonStyle : buttonStyle}
        onClick={() => handleToolChange('select')}
        title="Select (V)"
      >
        ↖
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={currentTool === 'text'}
        disabled={disabled}
        style={currentTool === 'text' ? activeButtonStyle : buttonStyle}
        onClick={() => handleToolChange('text')}
        title="Text (T)"
      >
        T
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        disabled={disabled}
        style={buttonStyle}
        onClick={onCreateSticky}
        title="Sticky note (N)"
      >
        +
      </button>
      {/* Story 10: Shape button with kind menu */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Shape (S)"
          aria-pressed={currentTool === 'shape'}
          disabled={disabled}
          style={currentTool === 'shape' ? activeButtonStyle : buttonStyle}
          onClick={() => handleToolChange('shape')}
          title="Shape (S)"
        >
          □
        </button>
        {currentTool === 'shape' && (
          <div
            data-testid="shape-kind-menu"
            role="menu"
            aria-label="Shape kind"
            style={{
              position: 'absolute',
              top: 44,
              left: 0,
              background: '#ffffff',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              zIndex: 30,
            }}
          >
            <button
              type="button"
              role="menuitem"
              aria-label="Rectangle"
              aria-pressed={shapeKind === 'rect'}
              style={{
                padding: '4px 12px',
                border: 'none',
                background: shapeKind === 'rect' ? '#dbeafe' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
              onClick={() => onShapeKindChange?.('rect')}
            >
              Rectangle
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="Ellipse"
              aria-pressed={shapeKind === 'ellipse'}
              style={{
                padding: '4px 12px',
                border: 'none',
                background: shapeKind === 'ellipse' ? '#dbeafe' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
              onClick={() => onShapeKindChange?.('ellipse')}
            >
              Ellipse
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="Diamond"
              aria-pressed={shapeKind === 'diamond'}
              style={{
                padding: '4px 12px',
                border: 'none',
                background: shapeKind === 'diamond' ? '#dbeafe' : 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
              onClick={() => onShapeKindChange?.('diamond')}
            >
              Diamond
            </button>
          </div>
        )}
      </div>
      {/* Story 10: Connector button */}
      <button
        type="button"
        aria-label="Connector (L)"
        aria-pressed={currentTool === 'connector'}
        disabled={disabled}
        style={currentTool === 'connector' ? activeButtonStyle : buttonStyle}
        onClick={() => handleToolChange('connector')}
        title="Connector (L)"
      >
        →
      </button>
      {/* Story 11: Pen button */}
      <button
        type="button"
        aria-label="Pen (P)"
        aria-pressed={currentTool === 'pen'}
        disabled={disabled}
        style={currentTool === 'pen' ? activeButtonStyle : buttonStyle}
        onClick={() => handleToolChange('pen')}
        title="Pen (P)"
      >
        ✎
      </button>
      <button
        type="button"
        aria-label="Undo (Ctrl+Z)"
        disabled={!canUndo}
        style={buttonStyle}
        onClick={onUndo}
        title="Undo (Ctrl+Z)"
      >
        ↶
      </button>
      <button
        type="button"
        aria-label="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        style={buttonStyle}
        onClick={onRedo}
        title="Redo (Ctrl+Shift+Z)"
      >
        ↷
      </button>
    </div>
  );
}
