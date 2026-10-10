import type { JSX } from 'react';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from '../../shared/config';
import type { Tool } from './useTool';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  tool: Tool;
  onSelectTool(tool: Tool): void;
  // Disabled while the board cannot be loaded (load_failed), TC-23.
  disabled?: boolean;
  undo: UndoState;
}

// Fixed left-side vertical toolbar.
export function Toolbar({
  onCreateSticky,
  tool,
  onSelectTool,
  disabled = false,
  undo
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – or press V"
        onClick={() => onSelectTool('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M5 2l11 8-5 1 3 6-2.5 1-3-6-3.5 3z" fill="#fff" stroke="#0f172a" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – or press T, then click the board"
        onClick={() => onSelectTool('text')}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 4h14M10 4v13" fill="none" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note – or press N, or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="2" y="2" width="16" height="16" rx="2" fill={STICKY_COLORS[DEFAULT_STICKY_COLOR]} stroke="#0f172a" strokeWidth="1.5" />
          <path d="M12 18V14a2 2 0 0 1 2-2h4" fill="none" stroke="#0f172a" strokeWidth="1.5" />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
