import type { ReactNode } from 'react';
import type { Tool } from './useTool';

/**
 * Top-left toolbar (story 7: undo/redo moved here from NoteToolbar;
 * story 9: tool row — Select (V), Text (T), sticky note (N)).
 * `undoButtons` is injected by the board page so the toolbar stays presentational.
 */
export interface ToolbarProps {
  tool: Tool;
  onToolChange(t: Tool): void;
  /** Viewers (role guest) cannot arm the text tool; sticky stays a shortcut. */
  canEdit: boolean;
  /** One-click sticky note at the view centre (story 1). */
  onCreateSticky(): void;
  undoButtons: ReactNode;
}

const buttonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 16,
  padding: '4px 6px',
  borderRadius: 4,
};

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { tool, onToolChange, canEdit, onCreateSticky, undoButtons } = props;
  return (
    <div
      data-testid="toolbar"
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      {/* Tool row (story 9) */}
      <button
        type="button"
        data-testid="select-tool-button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        style={{ ...buttonStyle, opacity: 0.9 }}
        onClick={() => onToolChange('select')}
      >
        ⬚
      </button>
      <button
        type="button"
        data-testid="text-tool-button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        disabled={!canEdit}
        style={{
          ...buttonStyle,
          fontFamily: 'Georgia, serif',
          fontWeight: 700,
          opacity: canEdit ? 0.9 : 0.4,
        }}
        onClick={() => onToolChange('text')}
      >
        T
      </button>
      <button
        type="button"
        data-testid="sticky-note-button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        style={{ ...buttonStyle, opacity: 0.9 }}
        onClick={onCreateSticky}
      >
        🗒️
      </button>
      <span style={{ width: 1, height: 20, background: '#ddd', margin: '0 4px' }} />
      {undoButtons}
    </div>
  );
}
