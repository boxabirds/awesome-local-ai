import { type CSSProperties, useState, type ReactNode } from 'react';
import type { UseUndoResult } from './useUndo';
import type { ToolId } from '@/client/tools/useActiveTool';
import type { ShapeKind } from '@/shared/objects/shape';
import { SHAPE_KINDS } from '@/shared/config';
import { UndoButtons } from './UndoButtons';

interface ToolbarProps extends UseUndoResult {
  onCreateSticky(): void;
  tool: ToolId;
  setTool(t: ToolId): void;
  canEdit: boolean;
  shapeKind: ShapeKind;
  setShapeKind(k: ShapeKind): void;
}

export function Toolbar({ onCreateSticky, canUndo, canRedo, undo, redo, tool, setTool, canEdit, shapeKind, setShapeKind }: ToolbarProps): ReactNode {
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  const containerStyle: CSSProperties = {
    position: 'fixed',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    zIndex: 10,
  };

  const baseBtnStyle: CSSProperties = {
    width: '40px',
    height: '40px',
    border: '1px solid #ccc',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };

  const labelForTool = (t: ToolId) => {
    switch (t) {
      case 'select': return 'Select (V)';
      case 'text': return 'Text (T)';
      case 'sticky': return 'Sticky note (N)';
      case 'shape': return 'Shape (S)';
      case 'connector': return 'Connector (L)';
      default: return t;
    }
  };

  const handleShapeKindClick = (k: ShapeKind) => {
    setShapeKind(k);
    setShapeMenuOpen(false);
  };

  return (
    <div style={containerStyle} data-testid="toolbar">
      <UndoButtons canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo} />
      <button
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – V"
        onClick={() => setTool('select')}
        style={{ ...baseBtnStyle, backgroundColor: tool === 'select' ? '#2979ff' : '#f5f5f5', color: tool === 'select' ? '#fff' : '#333' }}
        data-testid="select-tool-btn"
      >
        ↖
      </button>
      <button
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – T"
        onClick={() => setTool('text')}
        disabled={!canEdit}
        style={{ ...baseBtnStyle, backgroundColor: tool === 'text' ? '#2979ff' : '#f5f5f5', color: tool === 'text' ? '#fff' : '#333', opacity: canEdit ? 1 : 0.5 }}
        data-testid="text-tool-btn"
      >
        T
      </button>
      <button
        aria-label="Sticky note (N)"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{ ...baseBtnStyle, backgroundColor: '#FFF59D', cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.5 }}
        data-testid="sticky-note-btn"
      >
        📝
      </button>

      {/* Shape button with kind menu */}
      <div style={{ position: 'relative' }}>
        <button
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          aria-expanded={shapeMenuOpen}
          title="Shape – S"
          onClick={() => {
            if (!canEdit) return;
            setShapeMenuOpen(!shapeMenuOpen);
          }}
          disabled={!canEdit}
          style={{ ...baseBtnStyle, backgroundColor: tool === 'shape' ? '#2979ff' : '#f5f5f5', color: tool === 'shape' ? '#fff' : '#333', opacity: canEdit ? 1 : 0.5 }}
          data-testid="shape-tool-btn"
        >
          ▢
        </button>
        {shapeMenuOpen && (
          <div
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              marginLeft: '4px',
              backgroundColor: '#fff',
              border: '1px solid #ccc',
              borderRadius: '6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              minWidth: '80px',
              zIndex: 20,
            }}
          >
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                data-testid={`shape-kind-${k}`}
                onClick={() => handleShapeKindClick(k)}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  backgroundColor: shapeKind === k ? '#e3f2fd' : 'transparent',
                  fontWeight: shapeKind === k ? 600 : 400,
                }}
              >
                {k === 'rect' ? 'Rectangle' : k === 'ellipse' ? 'Ellipse' : 'Diamond'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Connector button */}
      <button
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector – L"
        onClick={() => setTool('connector')}
        disabled={!canEdit}
        style={{ ...baseBtnStyle, backgroundColor: tool === 'connector' ? '#2979ff' : '#f5f5f5', color: tool === 'connector' ? '#fff' : '#333', opacity: canEdit ? 1 : 0.5 }}
        data-testid="connector-tool-btn"
      >
        ➜
      </button>

      {/* Pen button */}
      <button
        aria-label="Pen (P)"
        aria-pressed={tool === 'pen'}
        title="Pen – P"
        onClick={() => setTool('pen')}
        disabled={!canEdit}
        style={{ ...baseBtnStyle, backgroundColor: tool === 'pen' ? '#2979ff' : '#f5f5f5', color: tool === 'pen' ? '#fff' : '#333', opacity: canEdit ? 1 : 0.5 }}
        data-testid="pen-tool-btn"
      >
        ✏️
      </button>
    </div>
  );
}
