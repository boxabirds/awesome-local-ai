import * as React from 'react';
import type { useUndo } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { ToolId } from './useTool';

interface ToolbarProps {
  onCreateSticky(): void;
  undoProps?: ReturnType<typeof useUndo>;
  // Tool props (stories 9-12)
  activeTool?: ToolId;
  onToolChange?(tool: ToolId): void;
  // Shape kind for shape tool
  shapeKind?: string;
  onShapeKindChange?(kind: string): void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const {
    onCreateSticky,
    undoProps,
    activeTool,
    onToolChange,
    shapeKind = 'rect',
    onShapeKindChange,
  } = props;

  const [shapeMenuOpen, setShapeMenuOpen] = React.useState(false);

  const kinds = ['rect', 'ellipse', 'diamond'] as const;
  const kindLabels: Record<string, string> = {
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    diamond: 'Diamond',
  };

  return (
    <div
      className="toolbar"
      style={{
        position: 'fixed',
        left: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        zIndex: 99,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Select */}
      <button
        onClick={() => onToolChange?.('select')}
        aria-label="Select (V)"
        aria-pressed={activeTool === 'select'}
        title="Select – or press V"
        style={toolBtnStyle(activeTool === 'select', () => onToolChange?.('select'))}
      >
        👆
      </button>

      {/* Sticky note */}
      <button
        onClick={() => onCreateSticky()}
        aria-label="Sticky note (N)"
        title="Sticky note – or double-click the board"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        📝
      </button>

      {/* Shape button with submenu */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => {
            if (onToolChange && !shapeMenuOpen) {
              onToolChange('shape');
            } else {
              setShapeMenuOpen((o) => !o);
            }
          }}
          aria-label={`Shape (${kinds.find((k) => k === shapeKind)?.toUpperCase() || 'RECT'})`}
          aria-pressed={activeTool === 'shape'}
          aria-expanded={shapeMenuOpen}
          title="Shapes – press S"
          style={toolBtnStyle(activeTool === 'shape', () => {})}
        >
          <span style={{ fontSize: '18px' }}>{shapeKind === 'rect' ? '▭' : shapeKind === 'ellipse' ? '○' : '◇'}</span>
        </button>

        {/* Shape kind menu */}
        {shapeMenuOpen && (
          <div
            style={{
              position: 'absolute',
              left: '48px',
              top: '0',
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              zIndex: 100,
            }}
            role="menu"
          >
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => {
                  onShapeKindChange?.(k);
                  setShapeMenuOpen(false);
                  if (onToolChange) onToolChange('shape');
                }}
                role="menuitemradio"
                aria-checked={shapeKind === k}
                aria-label={kindLabels[k]}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '4px',
                  background: shapeKind === k ? '#e8f0fe' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '13px',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '18px' }}>
                  {k === 'rect' ? '▭' : k === 'ellipse' ? '○' : '◇'}
                </span>
                {kindLabels[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Connector */}
      <button
        onClick={() => onToolChange?.('connector')}
        disabled={!onToolChange}
        aria-label="Connector (L)"
        aria-pressed={activeTool === 'connector'}
        title="Connector – press L"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: activeTool === 'connector' ? '#e8f0fe' : '#fff',
          cursor: onToolChange ? 'pointer' : 'not-allowed',
          opacity: onToolChange ? 1 : 0.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          boxShadow: activeTool === 'connector' ? '0 0 0 2px #1a73e8' : '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        →
      </button>

      {/* Pen */}
      <button
        onClick={() => onToolChange?.('pen')}
        disabled={!onToolChange}
        aria-label="Pen (P)"
        aria-pressed={activeTool === 'pen'}
        title="Pen – or press P"
        style={{
          width: '40px',
          height: '40px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          background: activeTool === 'pen' ? '#e8f0fe' : '#fff',
          cursor: onToolChange ? 'pointer' : 'not-allowed',
          opacity: onToolChange ? 1 : 0.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          boxShadow: activeTool === 'pen' ? '0 0 0 2px #1a73e8' : '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        ✏️
      </button>

      {undoProps && <UndoButtons {...undoProps} />}
    </div>
  );
}

function toolBtnStyle(active: boolean, onClick: (() => void) | undefined): React.CSSProperties {
  return {
    width: '40px',
    height: '40px',
    border: '1px solid #ccc',
    borderRadius: '8px',
    background: active ? '#e8f0fe' : '#fff',
    cursor: onClick ? 'pointer' : 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    boxShadow: active ? '0 0 0 2px #1a73e8' : '0 2px 4px rgba(0,0,0,0.1)',
  };
}
