import React from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** When true the create button is disabled (e.g. the board failed to load). */
  disabled?: boolean;
  undo?: UndoButtonsProps;
  /** Current tool; tool buttons are shown when `onSelectTool` is provided. */
  tool?: Tool;
  onSelectTool?(tool: Tool): void;
}

const TOOL_BUTTON_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 36,
  border: 'none',
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1,
};

/**
 * Left-side toolbar: the tool picker (story 9) and the sticky note creator.
 * Pointer events are stopped here so a click never reaches the viewport (which
 * would pan the board or clear the selection).
 */
export function Toolbar({
  onCreateSticky,
  disabled = false,
  undo,
  tool = 'select',
  onSelectTool,
}: ToolbarProps) {
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
        gap: 6,
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 6,
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
        zIndex: 10,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {onSelectTool && (
        <>
          <button
            type="button"
            aria-label="Select (V)"
            title="Select – or press V"
            aria-pressed={tool === 'select'}
            data-testid="tool-select-button"
            onClick={() => onSelectTool('select')}
            style={{
              ...TOOL_BUTTON_STYLE,
              backgroundColor: tool === 'select' ? '#E3F2FD' : 'transparent',
              color: tool === 'select' ? '#1565C0' : '#5f6368',
              cursor: 'pointer',
            }}
          >
            {/* Arrow cursor glyph */}
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path
                d="M5 2.5l10 5.2-4.3 1.4L8.4 15 5 2.5z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Text (T)"
            title="Text – or press T"
            aria-pressed={tool === 'text'}
            data-testid="tool-text-button"
            disabled={disabled}
            onClick={() => onSelectTool('text')}
            style={{
              ...TOOL_BUTTON_STYLE,
              backgroundColor: tool === 'text' ? '#E3F2FD' : 'transparent',
              color: tool === 'text' ? '#1565C0' : '#5f6368',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            T
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note – or press N, or double-click the board"
        data-testid="create-sticky-button"
        disabled={disabled}
        onClick={onCreateSticky}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: 'none',
          borderRadius: 8,
          backgroundColor: '#FFF59D',
          color: '#5f5324',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        {/* Folded-corner sticky note glyph */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 3h14v9l-5 5H3z" fill="currentColor" opacity="0.35" />
          <path d="M12 17v-5h5" fill="currentColor" opacity="0.6" />
        </svg>
      </button>
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
