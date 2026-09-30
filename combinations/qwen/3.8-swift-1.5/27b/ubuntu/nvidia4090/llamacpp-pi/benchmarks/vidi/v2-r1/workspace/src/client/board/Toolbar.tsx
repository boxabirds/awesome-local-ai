import type { CSSProperties } from 'react';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

interface ToolbarProps {
  /** Story 9: the active tool (Select / Text). */
  tool: Tool;
  onToolChange: (t: Tool) => void;
  onCreateSticky: () => void;
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

function toolButtonStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    width: 40,
    height: 40,
    border: '1px solid rgba(0,0,0,0.1)',
    borderRadius: 6,
    backgroundColor: active ? '#2196F3' : disabled ? '#e0e0e0' : '#fff',
    color: active ? '#fff' : '#333',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled && !active ? 0.6 : 1,
  };
}

export function Toolbar({ tool, onToolChange, onCreateSticky, disabled, canUndo, canRedo, onUndo, onRedo }: ToolbarProps) {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="toolbar"
      onPointerDown={handlePointerDown}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 8,
        padding: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      <button
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        data-testid="tool-select"
        title="Select (V)"
        onClick={() => onToolChange('select')}
        style={toolButtonStyle(tool === 'select', false)}
      >
        ⬚
      </button>
      <button
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        data-testid="tool-text"
        title="Text (T) – click the board to write"
        disabled={disabled}
        onClick={() => onToolChange('text')}
        style={toolButtonStyle(tool === 'text', Boolean(disabled))}
      >
        T
      </button>
      <button
        aria-label="Sticky note (N)"
        data-testid="create-sticky"
        title="Sticky note (N) – or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 6,
          backgroundColor: disabled ? '#e0e0e0' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        +
      </button>
      {onUndo && onRedo && (
        <UndoButtons
          canUndo={!!canUndo}
          canRedo={!!canRedo}
          undo={onUndo}
          redo={onRedo}
        />
      )}
    </div>
  );
}
