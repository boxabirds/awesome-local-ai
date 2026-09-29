import React from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undoState?: UseUndoResult;
  tool?: Tool;
  onToolChange?(t: Tool): void;
}

/** Fixed left-side vertical toolbar. */
export function Toolbar({ onCreateSticky, disabled, undoState, tool = 'select', onToolChange }: ToolbarProps) {
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
