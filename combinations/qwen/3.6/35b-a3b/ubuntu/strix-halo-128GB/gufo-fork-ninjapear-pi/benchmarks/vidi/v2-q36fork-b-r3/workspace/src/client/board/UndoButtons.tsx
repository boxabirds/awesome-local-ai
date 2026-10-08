import React from 'react';

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  disabled: boolean;
  onUndo(): void;
  onRedo(): void;
}

/**
 * Undo and Redo buttons for the left toolbar.
 * Disabled when there is nothing to undo/redo or when the board cannot be edited.
 * Shows tooltip with keyboard shortcut hints.
 */
export function UndoButtons({
  canUndo,
  canRedo,
  disabled,
  onUndo,
  onRedo,
}: UndoButtonsProps) {
  const btnStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    border: 'none',
    borderRadius: 8,
    background: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    cursor: disabled || !canUndo && disabled ? 'not-allowed' : 'pointer',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: disabled || !canUndo ? '#ccc' : '#333',
    opacity: disabled || !canUndo ? 0.6 : 1,
    pointerEvents: disabled || !canUndo ? 'none' : 'auto',
  };

  const redoBtnStyle: React.CSSProperties = {
    ...btnStyle,
    color: disabled || !canRedo ? '#ccc' : '#333',
    opacity: disabled || !canRedo ? 0.6 : 1,
    pointerEvents: disabled || !canRedo ? 'none' : 'auto',
  };

  return (
    <>
      <button
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={disabled || !canUndo}
        onClick={onUndo}
        style={btnStyle}
      >
        ↩
      </button>
      <button
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={disabled || !canRedo}
        onClick={onRedo}
        style={redoBtnStyle}
      >
        ↪
      </button>
    </>
  );
}
