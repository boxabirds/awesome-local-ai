// src/client/board/Toolbar.tsx
import type { ReactElement } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky: () => void;
  disabled?: boolean;
  undo?: UseUndoResult;
  tool: Tool;
  setTool: (t: Tool) => void;
}

export function Toolbar(props: ToolbarProps): ReactElement {
  const { disabled, undo, tool, setTool } = props;

  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Select tool */}
      <button
        aria-label="Select (V)"
        title="Select – V"
        data-testid="select-tool-btn"
        aria-pressed={tool === 'select'}
        onClick={() => setTool('select')}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: tool === 'select' ? '#BBDEFB' : '#f5f5f5',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        ↖
      </button>

      {/* Text tool */}
      <button
        aria-label="Text (T)"
        title="Text – T"
        data-testid="text-tool-btn"
        aria-pressed={tool === 'text'}
        onClick={disabled ? undefined : () => setTool('text')}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: tool === 'text' ? '#BBDEFB' : '#f5f5f5',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        T
      </button>

      {/* Sticky note button */}
      <button
        aria-label="Sticky note (N)"
        title="Sticky note – N, or double-click the board"
        data-testid="create-sticky-btn"
        onClick={disabled ? undefined : props.onCreateSticky}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          background: disabled ? '#e0e0e0' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        📝
      </button>
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
