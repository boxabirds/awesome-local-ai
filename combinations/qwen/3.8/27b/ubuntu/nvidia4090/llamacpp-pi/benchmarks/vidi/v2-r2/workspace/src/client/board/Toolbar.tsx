import { type CSSProperties, type JSX } from 'react';
import { STICKY_COLORS } from '../../shared/config';
import type { Tool } from './useTool';
import { UndoButtons } from './UndoButtons';
import type { UndoActions } from './useUndo';

export interface ToolbarProps {
  /** Create a sticky note at the viewport centre (N). */
  onCreateSticky(): void;
  /** The active tool (story 9) and its setter (Toolbar clicks). */
  tool: Tool;
  onToolChange(t: Tool): void;
  /**
   * When true (persist.client_status load_failed) the Sticky note button is
   * disabled, so a load-failed board can never create a note. The Text tool
   * is also unavailable (board.readonly): the Text button is disabled and
   * the T shortcut is ignored.
   */
  disabled?: boolean;
  /** Undo / Redo state and actions for this tab (story 8, undo.controls). */
  undo: UndoActions;
}

/** Shared 40x40 tool-button look. */
const TOOL_BUTTON_STYLE: CSSProperties = {
  width: 40,
  height: 40,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: '1px solid rgba(0,0,0,0.18)',
  borderRadius: 6,
  cursor: 'pointer',
};

/**
 * Fixed left toolbar: the Select and Text tools (story 9), the Sticky note
 * button (story 2; shortcut N, introduced by story 9) and the Undo / Redo
 * buttons (story 8).
 *
 * It is rendered in screen space (outside the board's transformed world
 * layer) and stops pointer/double-click propagation so a press on it never
 * pans the board or creates a note.
 */
export function Toolbar({
  onCreateSticky,
  tool,
  onToolChange,
  disabled = false,
  undo,
}: ToolbarProps): JSX.Element {
  return (
    <div
      data-testid="sticky-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: 'rgba(255,255,255,0.94)',
        border: '1px solid #d8d8d0',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 2000,
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={tool === 'select'}
        data-testid="select-button"
        onClick={() => onToolChange('select')}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: tool === 'select' ? '#e8f0fe' : '#ffffff',
          outline: tool === 'select' ? '1px solid #1a73e8' : 'none',
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3c3c34"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 3l7 17 2.5-7.5L21 10z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title={disabled ? 'Board unavailable' : 'Text – T, then click the board'}
        aria-pressed={tool === 'text'}
        disabled={disabled}
        data-testid="text-button"
        onClick={() => onToolChange('text')}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: tool === 'text' ? '#e8f0fe' : '#ffffff',
          color: '#3c3c34',
          fontSize: 18,
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        <span aria-hidden="true">T</span>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title={disabled ? 'Board unavailable' : 'Sticky note – N, or double-click the board'}
        disabled={disabled}
        data-testid="sticky-note-button"
        onClick={onCreateSticky}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: STICKY_COLORS.yellow,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            display: 'block',
            background: 'rgba(255,255,255,0.55)',
            border: '1.5px solid rgba(0,0,0,0.25)',
            borderRadius: 2,
          }}
        />
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
