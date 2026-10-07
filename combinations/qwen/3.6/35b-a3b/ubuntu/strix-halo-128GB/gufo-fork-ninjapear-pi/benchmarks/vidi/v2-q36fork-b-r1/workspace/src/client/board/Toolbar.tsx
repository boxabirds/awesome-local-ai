import { type CSSProperties, type ReactNode } from 'react';
import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';
import { UndoButtons } from './UndoButtons';

interface ToolbarProps extends UseUndoResult {
  onCreateSticky(): void;
  tool: Tool;
  setTool(t: Tool): void;
  canEdit: boolean;
}

export function Toolbar({ onCreateSticky, canUndo, canRedo, undo, redo, tool, setTool, canEdit }: ToolbarProps): ReactNode {
  const containerStyle: CSSProperties = {
    position: 'fixed',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '8px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    zIndex: 10,
  };

  const baseBtnStyle: CSSProperties = {
    width: '40px',
    height: '40px',
    border: '1px solid #ccc',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };

  return (
    <div style={containerStyle} data-testid="toolbar">
      <UndoButtons canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo} />
      <button
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – V"
        onClick={(e) => {
          e.stopPropagation();
          setTool('select');
        }}
        style={{ ...baseBtnStyle, backgroundColor: tool === 'select' ? '#2979ff' : '#f5f5f5', color: tool === 'select' ? '#fff' : '#333' }}
        data-testid="select-tool-btn"
      >
        ↖
      </button>
      <button
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – T"
        onClick={(e) => {
          e.stopPropagation();
          setTool('text');
        }}
        disabled={!canEdit}
        style={{ ...baseBtnStyle, backgroundColor: tool === 'text' ? '#2979ff' : '#f5f5f5', color: tool === 'text' ? '#fff' : '#333', opacity: canEdit ? 1 : 0.5 }}
        data-testid="text-tool-btn"
      >
        T
      </button>
      <button
        aria-label="Sticky note (N)"
        title="Sticky note – or double-click the board"
        onClick={(e) => {
          e.stopPropagation();
          onCreateSticky();
        }}
        style={{ ...baseBtnStyle, backgroundColor: '#FFF59D', cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.5 }}
        data-testid="sticky-note-btn"
      >
        📝
      </button>
    </div>
  );
}
