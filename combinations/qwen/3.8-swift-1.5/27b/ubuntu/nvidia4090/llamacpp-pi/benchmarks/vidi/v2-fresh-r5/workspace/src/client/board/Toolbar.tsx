import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoBinding } from './useUndo';
import type { Tool } from './useTool';

interface ToolbarProps {
  onCreateSticky: () => void;
  /** When true the create button is disabled (board failed to load). */
  disabled?: boolean;
  /** Undo/redo binding (story 8). */
  undo?: UndoBinding;
  /** Active tool (story 9). */
  tool?: Tool;
  /** Change the active tool. */
  onToolChange?: (t: Tool) => void;
}

/**
 * Fixed left-side toolbar with tool buttons, a Sticky note button and undo/redo buttons.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky, disabled = false, undo, tool = 'select', onToolChange } = props;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board toolbar"
      onPointerDown={handlePointerDown}
      style={{
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
    >
      {/* Select tool */}
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – V"
        data-testid="tool-select-btn"
        onClick={() => onToolChange?.('select')}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          border: tool === 'select' ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.2)',
          background: tool === 'select' ? '#E8F0FE' : 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
        }}
      >
        ↖
      </button>

      {/* Text tool */}
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – T"
        data-testid="tool-text-btn"
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          border: tool === 'text' ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.2)',
          background: tool === 'text' ? '#E8F0FE' : 'white',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        T
      </button>

      {/* Sticky note button */}
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note – N"
        data-testid="create-sticky-btn"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          border: '1px solid rgba(0,0,0,0.2)',
          background: disabled ? '#E8EAED' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        +
      </button>

      {undo && (
        <div style={{ height: '1px', background: 'rgba(0,0,0,0.15)', margin: '0 2px' }} />
      )}
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
