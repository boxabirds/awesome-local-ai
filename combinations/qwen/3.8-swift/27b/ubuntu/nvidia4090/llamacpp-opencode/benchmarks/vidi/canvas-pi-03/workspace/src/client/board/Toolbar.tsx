import type { CSSProperties, JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky: () => void;
  /** When true (board `load_failed`) the Sticky note and Text buttons are disabled. */
  disabled?: boolean;
  /** Story 8: undo/redo state for the toolbar buttons (below the tools). */
  undo?: UndoState;
  /** Story 9: the active board tool (Select / Text buttons). */
  tool: Tool;
  onToolChange: (t: Tool) => void;
}

/**
 * Fixed left-side toolbar with the Select / Text tool buttons (story 9),
 * the Sticky note button and, below the tools, the Undo / Redo buttons
 * (story 8). Stops pointer propagation so clicks never reach the viewport
 * (which would pan / clear the selection).
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      data-testid="main-toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        backgroundColor: '#ffffff',
        border: '1px solid #d0d7de',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={props.tool === 'select'}
        data-testid="select-tool-button"
        onClick={() => props.onToolChange('select')}
        style={toolButtonStyle(props.tool === 'select')}
      >
        {/* Cursor glyph */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M4 2l12 8-6 1 3 6-2.5 1.2-3-6L4 16z"
            fill="none"
            stroke="#333"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text – T, then click the board"
        aria-pressed={props.tool === 'text'}
        data-testid="text-tool-button"
        disabled={props.disabled}
        onClick={() => props.onToolChange('text')}
        style={toolButtonStyle(props.tool === 'text')}
      >
        <span
          style={{
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 700,
            fontSize: 18,
            color: '#333',
          }}
        >
          T
        </span>
      </button>
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-note-button"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFF59D',
          border: '1px solid #c9b458',
          borderRadius: 6,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {/* Simple sticky-note glyph */}
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 3h16v10l-6 6H3z" fill="#fff8c4" stroke="#8a7a2a" strokeWidth="1.5" />
          <path d="M13 19v-6h6" fill="none" stroke="#8a7a2a" strokeWidth="1.5" />
        </svg>
      </button>
      {props.undo && <UndoButtons {...props.undo} />}
    </div>
  );
}

/** Shared tool-button look; the active tool is highlighted. */
function toolButtonStyle(active: boolean): CSSProperties {
  return {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: active ? '#D6E4FF' : '#FFFFFF',
    border: `1px solid ${active ? '#1A73E8' : '#d0d7de'}`,
    borderRadius: 6,
    cursor: 'pointer',
    padding: 0,
  };
}
