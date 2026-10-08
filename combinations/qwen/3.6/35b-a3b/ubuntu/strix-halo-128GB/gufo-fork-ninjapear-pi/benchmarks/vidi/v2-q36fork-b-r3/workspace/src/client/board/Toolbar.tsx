import React from 'react';
import { UndoButtons } from './UndoButtons';

interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

export function Toolbar({
  onCreateSticky,
  disabled = false,
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
        aria-label="Sticky note"
        title={disabled ? 'Board could not be loaded' : 'Sticky note – or double-click the board'}
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
