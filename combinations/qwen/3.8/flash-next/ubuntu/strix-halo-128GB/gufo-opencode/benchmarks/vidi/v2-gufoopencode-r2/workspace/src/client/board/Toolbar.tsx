// Fixed left toolbar: the story 9 Select/Text tool pair, then the Sticky
// note button (creates a note at the centre of the visible board area),
// followed by the story 8 undo/redo pair.

import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { UndoState } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoState;
  // Story 9: the active board tool (select/text) and its switcher.
  tool?: Tool;
  onToolChange?(tool: Tool): void;
}

export function Toolbar({
  onCreateSticky,
  disabled = false,
  undo,
  tool = 'select',
  onToolChange,
}: ToolbarProps): React.JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-select"
        aria-label="Select (V)"
        title="Select – or press V"
        aria-pressed={tool === 'select'}
        onClick={() => onToolChange?.('select')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M4 2.5 14.5 9l-4.7 1.1L7.5 15 4 2.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <span>Select</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="tool-text"
        aria-label="Text (T)"
        title="Text – or press T, then click the board"
        aria-pressed={tool === 'text'}
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M3 4V2.5h12V4M9 2.5V15.5M6.5 15.5h5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Text</span>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note – or press N"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M2.5 2.5h13v10l-3 3h-10v-13Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M15.5 12.5h-3v3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span>Sticky note</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
