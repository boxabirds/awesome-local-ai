import React from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';
import type { ShapeKind } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** When true the create button is disabled (e.g. the board failed to load). */
  disabled?: boolean;
  undo?: UndoButtonsProps;
  /** Active tool state (story 9). */
  tool?: Tool;
  onToolChange?(tool: Tool): void;
  /** Shape kind (story 10) */
  shapeKind?: ShapeKind;
  onShapeKindChange?(kind: ShapeKind): void;
  /** Image pick handler (story 12) */
  onImagePick?(): void;
}

/**
 * Left-side creation toolbar. Pointer events are stopped here so a click never
 * reaches the viewport (which would pan the board or clear the selection).
 */
export function Toolbar({ onCreateSticky, disabled = false, undo, tool = 'select', onToolChange, shapeKind = 'rect', onShapeKindChange, onImagePick }: ToolbarProps) {
  return (
    <div
      data-testid="toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 6,
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
        zIndex: 10,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        data-testid="tool-select-button"
        onClick={() => onToolChange?.('select')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: tool === 'select' ? '2px solid #1976D2' : 'none',
          borderRadius: 8,
          backgroundColor: tool === 'select' ? '#E3F2FD' : '#fff',
          color: '#333',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        {/* Arrow cursor glyph */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3 1l10 7-4.5 1L11 14l-2.5 1-2.5-5L3 13z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        data-testid="tool-text-button"
        disabled={disabled}
        onClick={() => onToolChange?.('text')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: tool === 'text' ? '2px solid #1976D2' : 'none',
          borderRadius: 8,
          backgroundColor: tool === 'text' ? '#E3F2FD' : '#fff',
          color: disabled ? '#999' : '#333',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        T
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N)"
        data-testid="create-sticky-button"
        disabled={disabled}
        onClick={onCreateSticky}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: 'none',
          borderRadius: 8,
          backgroundColor: '#FFF59D',
          color: '#5f5324',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        {/* Folded-corner sticky note glyph */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 3h14v9l-5 5H3z" fill="currentColor" opacity="0.35" />
          <path d="M12 17v-5h5" fill="currentColor" opacity="0.6" />
        </svg>
      </button>
      {/* Shape button with kind menu (story 10) */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          data-testid="tool-shape-button"
          disabled={disabled}
          onClick={() => {
            if (tool === 'shape') {
              onToolChange?.('select');
            } else {
              onToolChange?.('shape');
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            border: tool === 'shape' ? '2px solid #1976D2' : 'none',
            borderRadius: 8,
            backgroundColor: tool === 'shape' ? '#E3F2FD' : '#fff',
            color: disabled ? '#999' : '#333',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          {/* Rectangle glyph */}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {/* Kind submenu when shape tool is active */}
        {tool === 'shape' && (
          <div
            data-testid="shape-kind-menu"
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              marginLeft: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              backgroundColor: '#fff',
              borderRadius: 8,
              padding: 6,
              boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
              zIndex: 10,
            }}
          >
            {(['rect', 'ellipse', 'diamond'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-label={kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Diamond'}
                aria-pressed={shapeKind === kind}
                data-testid={`shape-kind-${kind}`}
                onClick={() => onShapeKindChange?.(kind)}
                style={{
                  padding: '4px 8px',
                  border: shapeKind === kind ? '2px solid #1976D2' : '1px solid #ccc',
                  borderRadius: 4,
                  backgroundColor: shapeKind === kind ? '#E3F2FD' : '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                }}
              >
                {kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Diamond'}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Connector button (story 10) */}
      <button
        type="button"
        aria-label="Connector (L)"
        title="Connector (L)"
        aria-pressed={tool === 'connector'}
        data-testid="tool-connector-button"
        disabled={disabled}
        onClick={() => onToolChange?.('connector')}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: tool === 'connector' ? '2px solid #1976D2' : 'none',
          borderRadius: 8,
          backgroundColor: tool === 'connector' ? '#E3F2FD' : '#fff',
          color: disabled ? '#999' : '#333',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        {/* Arrow glyph */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M2 12L12 4M12 4L8 4M12 4L12 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {/* Pen button (story 11) */}
      <button
        type="button"
        aria-label="Pen (P)"
        title="Pen (P)"
        aria-pressed={tool === 'pen'}
        data-testid="tool-pen-button"
        disabled={disabled}
        onClick={() => {
          if (tool === 'pen') {
            onToolChange?.('select');
          } else {
            onToolChange?.('pen');
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: tool === 'pen' ? '2px solid #1976D2' : 'none',
          borderRadius: 8,
          backgroundColor: tool === 'pen' ? '#E3F2FD' : '#fff',
          color: disabled ? '#999' : '#333',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        {/* Pen glyph */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M2 14l1-4L11 2l3 3L6 13l-4 1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Image button (story 12) */}
      <button
        type="button"
        aria-label="Image (I)"
        title="Image (I)"
        data-testid="tool-image-button"
        disabled={disabled}
        onClick={() => {
          onImagePick?.();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: 'none',
          borderRadius: 8,
          backgroundColor: '#fff',
          color: disabled ? '#999' : '#333',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        {/* Image glyph */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" />
          <path d="M14 11l-3.5-3.5L4 13" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
