import type { ReactElement } from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoButtonsProps;
  tool?: Tool;
  onToolChange?(t: Tool): void;
}

export function Toolbar({ onCreateSticky, disabled = false, undo, tool = 'select', onToolChange }: ToolbarProps): ReactElement {
  return (
    <div
      className="board-toolbar"
      data-board-ui="true"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – V"
        className={`board-toolbar-btn${tool === 'select' ? ' board-toolbar-btn--active' : ''}`}
        onClick={() => onToolChange?.('select')}
        data-testid="select-tool-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 2l12 8-5.5 1.5L14 17l-2.5 1-3.5-5.5L4 16V2z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – T"
        className={`board-toolbar-btn${tool === 'text' ? ' board-toolbar-btn--active' : ''}`}
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
        data-testid="text-tool-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 4h12M10 4v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        className="board-toolbar-btn"
        onClick={onCreateSticky}
        disabled={disabled}
        data-testid="sticky-note-btn"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="2" fill="#FFF59D" stroke="#999" strokeWidth="1" />
          <line x1="6" y1="7" x2="14" y2="7" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="11" x2="12" y2="11" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
