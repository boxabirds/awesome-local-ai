import type { ReactElement } from 'react';
import type { Tool } from './useTool';

interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  tool?: Tool;
  onToolChange?: (t: Tool) => void;
}

const buttonStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  fontSize: 18,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#dbeafe',
  borderColor: '#3b82f6',
};

export function Toolbar({
  onCreateSticky,
  disabled = false,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  tool = 'select',
  onToolChange,
}: ToolbarProps): ReactElement {
  return (
    <div
      role="toolbar"
      aria-label="Board tools"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        gap: 8,
        padding: 8,
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        style={tool === 'select' ? activeButtonStyle : buttonStyle}
        onClick={() => onToolChange?.('select')}
        title="Select (V)"
      >
        ↖
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={disabled}
        style={tool === 'text' ? activeButtonStyle : buttonStyle}
        onClick={() => onToolChange?.('text')}
        title="Text (T)"
      >
        T
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        disabled={disabled}
        style={buttonStyle}
        onClick={onCreateSticky}
        title="Sticky note (N)"
      >
        +
      </button>
      <button
        type="button"
        aria-label="Undo (Ctrl+Z)"
        disabled={!canUndo}
        style={buttonStyle}
        onClick={onUndo}
        title="Undo (Ctrl+Z)"
      >
        ↶
      </button>
      <button
        type="button"
        aria-label="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        style={buttonStyle}
        onClick={onRedo}
        title="Redo (Ctrl+Shift+Z)"
      >
        ↷
      </button>
    </div>
  );
}
