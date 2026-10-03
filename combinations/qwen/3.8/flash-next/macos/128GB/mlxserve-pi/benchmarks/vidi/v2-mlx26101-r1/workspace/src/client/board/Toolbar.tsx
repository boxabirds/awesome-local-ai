import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Tool } from './useTool';
import { UndoButtons } from './UndoButtons';
import { useUndo, useUndoController } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * The tool the board is holding (story 9): Select or Text. Defaults to 'select'
   * so a rail rendered on its own (a story 2 / story 8 test) shows Select pressed.
   */
  tool?: Tool;
  /** Hold a tool from the rail (a Select / Text button click). */
  onSelectTool?(t: Tool): void;
  /**
   * True while the board could not be loaded: the Sticky note and Text buttons are
   * disabled so nothing can be created on a board that is not really there.
   */
  disabled?: boolean;
}

/** The fixed left-side tool rail. */
export function Toolbar({
  onCreateSticky,
  tool = 'select',
  onSelectTool,
  disabled = false,
}: ToolbarProps) {
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  const fire = () => {
    if (disabled) return;
    onCreateSticky();
  };
  const pick = (t: Tool) => {
    if (disabled && t !== 'select') return;
    onSelectTool?.(t);
  };
  const undo = useUndo(useUndoController(), !disabled);

  // A shared visual base for the two tool buttons; the active one is filled.
  const toolBtn = (active: boolean): CSSProperties => ({
    width: 40,
    height: 40,
    border: '1px solid #d0d3da',
    background: active ? '#dfe6ff' : '#fff',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1,
    opacity: disabled ? 0.4 : 1,
  });

  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: '#fff',
        border: '1px solid #e2e4ea',
        borderRadius: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        data-testid="select-tool"
        onClick={() => pick('select')}
        style={toolBtn(tool === 'select')}
      >
        {'\u2196'}
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        data-testid="text-tool"
        disabled={disabled}
        onClick={() => pick('text')}
        style={toolBtn(tool === 'text')}
      >
        T
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        data-testid="create-sticky"
        disabled={disabled}
        onClick={fire}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #d0d3da',
          background: '#FFF59D',
          borderRadius: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 18,
          lineHeight: 1,
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {'\u{1F4DD}'}
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
