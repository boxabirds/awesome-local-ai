import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  /** Per-user undo controls (story 8). Omit to hide the buttons. */
  undo?: UseUndoResult;
  /** Active tool (story 9) and its setter for the tool buttons. */
  tool?: Tool;
  setTool?(t: Tool): void;
}

const toolButtonStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  border: '1px solid #ccc',
  borderRadius: 8,
  backgroundColor: disabled ? '#E5E7EB' : active ? '#BBDEFB' : '#FFFFFF',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  opacity: disabled ? 0.5 : 1,
});

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky, disabled = false, undo, tool = 'select', setTool } = props;

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
        gap: 8,
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {setTool && (
        <>
          <button
            aria-label="Select (V)"
            title="Select – V"
            aria-pressed={tool === 'select'}
            onClick={disabled ? undefined : () => setTool('select')}
            disabled={disabled}
            style={toolButtonStyle(tool === 'select', disabled)}
          >
            ⬚
          </button>
          <button
            aria-label="Text (T)"
            title="Text – T, then click the board"
            aria-pressed={tool === 'text'}
            onClick={disabled ? undefined : () => setTool('text')}
            disabled={disabled}
            style={toolButtonStyle(tool === 'text', disabled)}
          >
            T
          </button>
        </>
      )}
      <button
        aria-label="Sticky note (N)"
        title="Sticky note – N, or double-click the board"
        onClick={disabled ? undefined : onCreateSticky}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          backgroundColor: disabled ? '#E5E7EB' : '#FFF59D',
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
      {undo && <UndoButtons undo={undo} disabled={disabled} />}
    </div>
  );
}
