import React from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { ToolId } from '@client/tools/useActiveTool';
import { SHAPE_KINDS, type ShapeKind } from '@shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undoState?: UseUndoResult;
  tool?: ToolId;
  onToolChange?(t: ToolId): void;
  shapeKind?: ShapeKind;
  onShapeKindChange?(k: ShapeKind): void;
}

const KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** Fixed left-side vertical toolbar. */
export function Toolbar({ onCreateSticky, disabled, undoState, tool = 'select', onToolChange, shapeKind = 'rect', onShapeKindChange }: ToolbarProps) {
  return (
    <div
      data-testid="toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: '16px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: 'rgba(255,255,255,0.9)',
        borderRadius: '8px',
        padding: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        data-testid="tool-select"
        onClick={() => onToolChange?.('select')}
        style={{
          width: '40px',
          height: '40px',
          border: tool === 'select' ? '2px solid #1976D2' : 'none',
          borderRadius: '6px',
          background: tool === 'select' ? '#E3F2FD' : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 2l12 10-5 1-2 5-1-5-4 1z" fill="#333" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        data-testid="tool-text"
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          border: tool === 'text' ? '2px solid #1976D2' : 'none',
          borderRadius: '6px',
          background: tool === 'text' ? '#E3F2FD' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>T</span>
      </button>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          data-testid="tool-shape"
          onClick={() => onToolChange?.('shape')}
          disabled={disabled}
          style={{
            width: '40px',
            height: '40px',
            border: tool === 'shape' ? '2px solid #1976D2' : 'none',
            borderRadius: '6px',
            background: tool === 'shape' ? '#E3F2FD' : 'transparent',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3" y="5" width="14" height="10" rx="1" fill="none" stroke="#333" strokeWidth="1.5" />
          </svg>
        </button>
        {tool === 'shape' && (
          <div
            role="menu"
            aria-label="Shape kind"
            data-testid="shape-kind-menu"
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              marginLeft: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: 4,
              background: '#FFFFFF',
              border: '1px solid #D0D0D0',
              borderRadius: 4,
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
              zIndex: 20,
            }}
          >
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="menuitemradio"
                aria-checked={shapeKind === k}
                aria-label={KIND_LABELS[k]}
                data-testid={`shape-kind-${k}`}
                onClick={() => onShapeKindChange?.(k)}
                style={{
                  textAlign: 'left',
                  padding: '4px 10px',
                  background: shapeKind === k ? '#E3F2FD' : 'transparent',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
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
        title="Connector (L)"
        aria-pressed={tool === 'connector'}
        data-testid="tool-connector"
        onClick={() => onToolChange?.('connector')}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          border: tool === 'connector' ? '2px solid #1976D2' : 'none',
          borderRadius: '6px',
          background: tool === 'connector' ? '#E3F2FD' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <line x1="3" y1="17" x2="15" y2="5" stroke="#333" strokeWidth="1.5" />
          <path d="M15 5l-4 1 3 3z" fill="#333" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Pen (P)"
        title="Pen (P)"
        aria-pressed={tool === 'pen'}
        data-testid="tool-pen"
        onClick={() => onToolChange?.('pen')}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          border: tool === 'pen' ? '2px solid #1976D2' : 'none',
          borderRadius: '6px',
          background: tool === 'pen' ? '#E3F2FD' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 17l1.5-4L14 3.5 16.5 6 7 15.5 3 17z" fill="none" stroke="#333" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="create-sticky-button"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          border: 'none',
          borderRadius: '6px',
          background: '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="1" fill="#FFF176" stroke="#B7A500" strokeWidth="1" />
          <line x1="5" y1="7" x2="15" y2="7" stroke="#9E8F00" strokeWidth="1.2" />
          <line x1="5" y1="11" x2="12" y2="11" stroke="#9E8F00" strokeWidth="1.2" />
        </svg>
      </button>
      {undoState && <UndoButtons {...undoState} />}
    </div>
  );
}
