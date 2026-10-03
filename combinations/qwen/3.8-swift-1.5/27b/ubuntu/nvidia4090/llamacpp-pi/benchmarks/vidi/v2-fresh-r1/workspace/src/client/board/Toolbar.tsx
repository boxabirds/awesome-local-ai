// Left-side vertical toolbar with the Sticky note button and Undo/Redo.

import { useCallback, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

interface ToolbarProps {
  onCreateSticky: () => void;
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Active tool (story 9). */
  tool?: Tool;
  /** Switch the active tool (story 9). */
  onToolChange?: (t: Tool) => void;
}

export function Toolbar({
  onCreateSticky,
  disabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  tool = 'select',
  onToolChange,
}: ToolbarProps) {
  const stopPointer = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
  }, []);
  const stopMouse = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      data-testid="toolbar"
      className="toolbar"
      style={{
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        zIndex: 100,
      }}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onPointerMove={stopPointer}
      onDoubleClick={stopMouse}
    >
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        data-testid="select-tool-btn"
        title="Select – V"
        onClick={() => onToolChange?.('select')}
        style={toolButtonStyle(tool === 'select')}
      >
        ➤
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        data-testid="text-tool-btn"
        title="Text – T"
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
        style={toolButtonStyle(tool === 'text')}
      >
        T
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        data-testid="sticky-note-btn"
        title="Sticky note – N, or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}
      >
        📝
      </button>
      <UndoButtons
        canUndo={canUndo ?? false}
        canRedo={canRedo ?? false}
        undo={onUndo ?? (() => {})}
        redo={onRedo ?? (() => {})}
      />
    </div>
  );
}

/** Style for the tool toggle buttons (select/text). */
function toolButtonStyle(active: boolean): CSSProperties {
  return {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: active ? '#E3F2FD' : 'white',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    color: active ? '#1976D2' : '#555',
    boxShadow: active ? 'inset 0 0 0 2px #1976D2' : 'none',
  };
}
