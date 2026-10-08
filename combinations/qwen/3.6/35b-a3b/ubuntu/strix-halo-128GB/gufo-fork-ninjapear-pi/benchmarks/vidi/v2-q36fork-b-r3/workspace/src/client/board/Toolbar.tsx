import React from 'react';
import { UndoButtons } from './UndoButtons';

interface ToolbarProps {
  onCreateSticky(): void;
  onCreateText?(worldPoint: { x: number; y: number }): string | void;
  disabled?: boolean;
  selectedTool?: 'select' | 'text';
  onToolChange?(tool: 'select' | 'text'): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

export function Toolbar({
  onCreateSticky,
  disabled = false,
  selectedTool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ToolbarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
      }}
    >
      <button
        aria-label="Select (V)"
        title="Select – or press V"
        aria-pressed={selectedTool === 'select'}
        onClick={() => onToolChange?.('select')}
        style={{
          width: 40,
          height: 40,
          border: selectedTool === 'select' ? '2px solid #2196F3' : 'none',
          borderRadius: 8,
          background: disabled ? '#eee' : (selectedTool === 'select' ? '#e3f2fd' : '#fff'),
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 16,
          fontWeight: selectedTool === 'select' ? 700 : 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: disabled ? '#999' : (selectedTool === 'select' ? '#1565c0' : '#333'),
          opacity: disabled ? 0.6 : 1,
        }}
      >
        V
      </button>
      <button
        aria-label="Text (T)"
        title="Text – or press T"
        aria-pressed={selectedTool === 'text'}
        disabled={disabled}
        onClick={() => !disabled && onToolChange?.('text')}
        style={{
          width: 40,
          height: 40,
          border: selectedTool === 'text' ? '2px solid #2196F3' : 'none',
          borderRadius: 8,
          background: disabled ? '#eee' : (selectedTool === 'text' ? '#e3f2fd' : '#fff'),
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 16,
          fontWeight: selectedTool === 'text' ? 700 : 400,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: disabled ? '#999' : (selectedTool === 'text' ? '#1565c0' : '#333'),
          opacity: disabled ? 0.6 : 1,
        }}
      >
        T
      </button>
      <button
        aria-label="Sticky note (N)"
        title={disabled ? 'Board could not be loaded' : 'Sticky note – or press N'}
        disabled={disabled}
        onClick={disabled ? undefined : onCreateSticky}
        style={{
          width: 40,
          height: 40,
          border: 'none',
          borderRadius: 8,
          background: disabled ? '#eee' : '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: disabled ? '#999' : '#333',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        📝
      </button>
      <UndoButtons
        canUndo={canUndo}
        canRedo={canRedo}
        disabled={disabled}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    </div>
  );
}
