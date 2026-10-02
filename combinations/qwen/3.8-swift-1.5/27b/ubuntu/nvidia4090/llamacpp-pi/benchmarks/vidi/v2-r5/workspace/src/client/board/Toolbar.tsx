// src/client/board/Toolbar.tsx
import type { ReactElement } from 'react';
import { useState } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';
import type { ToolId } from '../tools/useActiveTool';
import type { ShapeKind } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky: () => void;
  onOpenImagePicker?: () => void;
  disabled?: boolean;
  undo?: UseUndoResult;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  shapeKind: ShapeKind;
  setShapeKind: (k: ShapeKind) => void;
}

export function Toolbar(props: ToolbarProps): ReactElement {
  const { disabled, undo, tool, setTool, shapeKind, setShapeKind, onOpenImagePicker } = props;
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Select tool */}
      <button
        aria-label="Select (V)"
        title="Select – V"
        data-testid="select-tool-btn"
        aria-pressed={tool === 'select'}
        onClick={() => setTool('select')}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: tool === 'select' ? '#BBDEFB' : '#f5f5f5',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        ↖
      </button>

      {/* Text tool */}
      <button
        aria-label="Text (T)"
        title="Text – T"
        data-testid="text-tool-btn"
        aria-pressed={tool === 'text'}
        onClick={disabled ? undefined : () => setTool('text')}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: tool === 'text' ? '#BBDEFB' : '#f5f5f5',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        T
      </button>

      {/* Sticky note button */}
      <button
        aria-label="Sticky note (N)"
        title="Sticky note – N, or double-click the board"
        data-testid="create-sticky-btn"
        onClick={disabled ? undefined : props.onCreateSticky}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: disabled ? '#e0e0e0' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        📝
      </button>

      {/* Shape tool button with kind menu */}
      <div style={{ position: 'relative' }}>
        <button
          aria-label="Shape (S)"
          title="Shape – S"
          data-testid="shape-tool-btn"
          aria-pressed={tool === 'shape'}
          onClick={disabled ? undefined : () => {
            setTool('shape');
            setShapeMenuOpen(!shapeMenuOpen);
          }}
          disabled={disabled}
          style={{
            width: 40,
            height: 40,
            border: '1px solid #ccc',
            borderRadius: 8,
            background: tool === 'shape' ? '#BBDEFB' : '#f5f5f5',
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          □
        </button>

        {/* Shape kind menu */}
        {shapeMenuOpen && tool === 'shape' && (
          <div
            data-testid="shape-kind-menu"
            style={{
              position: 'absolute',
              left: 44,
              top: 0,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: 8,
              padding: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {(['rect', 'ellipse', 'diamond'] as ShapeKind[]).map((kind) => (
              <button
                key={kind}
                data-testid={`shape-kind-${kind}`}
                aria-label={kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Diamond'}
                aria-pressed={shapeKind === kind}
                onClick={() => {
                  setShapeKind(kind);
                  setShapeMenuOpen(false);
                }}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: 4,
                  background: shapeKind === kind ? '#BBDEFB' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 14,
                }}
              >
                {kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Diamond'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Connector tool button */}
      <button
        aria-label="Connector (L)"
        title="Connector – L"
        data-testid="connector-tool-btn"
        aria-pressed={tool === 'connector'}
        onClick={disabled ? undefined : () => setTool('connector')}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: tool === 'connector' ? '#BBDEFB' : '#f5f5f5',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        →
      </button>

      {/* Pen tool button (story 11) */}
      <button
        aria-label="Pen (P)"
        title="Pen – P"
        data-testid="pen-tool-btn"
        aria-pressed={tool === 'pen'}
        onClick={disabled ? undefined : () => setTool('pen')}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: tool === 'pen' ? '#BBDEFB' : '#f5f5f5',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        ✏️
      </button>

      {/* Image tool button (story 12) */}
      <button
        aria-label="Image (I)"
        title="Image – I"
        data-testid="image-tool-btn"
        onClick={disabled ? undefined : () => onOpenImagePicker?.()}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: '#f5f5f5',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        🖼️
      </button>

      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
