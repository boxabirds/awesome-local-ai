/**
 * Top-center toolbar: Select (V), Text (T) tools and Sticky note (N).
 */

import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';

interface ToolbarProps {
  tool: Tool;
  setTool(tool: Tool): void;
  canEdit: boolean;
  onCreateSticky(): void;
  undo: UseUndoResult;
}

export function Toolbar({ tool, setTool, canEdit, onCreateSticky, undo }: ToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Board tools"
      data-testid="toolbar"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #d0d0d0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        data-testid="select-btn"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => setTool('select')}
        style={{
          padding: '6px 10px',
          border: '1px solid transparent',
          borderRadius: 6,
          background: tool === 'select' ? '#e8f0fe' : 'transparent',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Select
      </button>
      <button
        type="button"
        data-testid="text-btn"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={!canEdit}
        onClick={() => setTool('text')}
        style={{
          padding: '6px 10px',
          border: '1px solid transparent',
          borderRadius: 6,
          background: tool === 'text' ? '#e8f0fe' : 'transparent',
          cursor: canEdit ? 'pointer' : 'default',
          fontSize: 13,
          opacity: canEdit ? 1 : 0.5,
        }}
      >
        Text
      </button>
      <button
        type="button"
        data-testid="sticky-btn"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={onCreateSticky}
        style={{
          padding: '6px 10px',
          border: '1px solid transparent',
          borderRadius: 6,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        Sticky
      </button>
      <div style={{ width: 1, background: '#d0d0d0', margin: '4px 2px' }} />
      <button
        type="button"
        data-testid="undo-btn"
        title="Undo (Ctrl/Cmd+Z)"
        aria-label="Undo (Ctrl/Cmd+Z)"
        disabled={!undo.canUndo}
        onClick={undo.undo}
        style={{
          padding: '6px 10px',
          border: '1px solid transparent',
          borderRadius: 6,
          background: 'transparent',
          cursor: undo.canUndo ? 'pointer' : 'default',
          fontSize: 13,
          opacity: undo.canUndo ? 1 : 0.4,
        }}
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="redo-btn"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        aria-label="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!undo.canRedo}
        onClick={undo.redo}
        style={{
          padding: '6px 10px',
          border: '1px solid transparent',
          borderRadius: 6,
          background: 'transparent',
          cursor: undo.canRedo ? 'pointer' : 'default',
          fontSize: 13,
          opacity: undo.canRedo ? 1 : 0.4,
        }}
      >
        Redo
      </button>
    </div>
  );
}
