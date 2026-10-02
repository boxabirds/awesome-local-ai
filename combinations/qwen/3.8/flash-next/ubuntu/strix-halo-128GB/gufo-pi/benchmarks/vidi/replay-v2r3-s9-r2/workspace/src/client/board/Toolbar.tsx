import React from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** When true the creation buttons are disabled (e.g. the board failed to load). */
  disabled?: boolean;
  undo?: UndoButtonsProps;
  /** Active creation tool; pass with `onSelectTool` to show the tool buttons. */
  tool?: Tool;
  onSelectTool?(t: Tool): void;
}

const BUTTON_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
};

/**
 * Left-side tool and creation toolbar. Pointer events are stopped here so a
 * click never reaches the viewport (which would pan the board or clear the
 * selection).
 */
export function Toolbar({
  onCreateSticky,
  disabled = false,
  undo,
  tool,
  onSelectTool,
}: ToolbarProps) {
  const showTools = Boolean(onSelectTool);

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
      {showTools && (
        <button
          type="button"
          aria-label="Select (V)"
          title="Select – V"
          aria-pressed={tool === 'select'}
          data-testid="select-tool-button"
          onClick={() => onSelectTool?.('select')}
          style={{
            ...BUTTON_BASE,
            backgroundColor: tool === 'select' ? '#D9E2F8' : 'transparent',
            color: '#3c4043',
          }}
        >
          {/* Arrow cursor glyph */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M5 3l10 6.5-4.4 1.1L13 16l-2.3.9-2.4-5.3L5 14z" fill="currentColor" />
          </svg>
        </button>
      )}
      {showTools && (
        <button
          type="button"
          aria-label="Text (T)"
          title="Text – T, then click the board"
          aria-pressed={tool === 'text'}
          data-testid="text-tool-button"
          disabled={disabled}
          onClick={() => onSelectTool?.('text')}
          style={{
            ...BUTTON_BASE,
            backgroundColor: tool === 'text' ? '#D9E2F8' : 'transparent',
            color: disabled ? '#9aa0a6' : '#3c4043',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            fontWeight: 600,
          }}
        >
          {/* Letter T glyph */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M4 4h12v2.6h-4.6V17h-2.8V6.6H4z" fill="currentColor" />
          </svg>
        </button>
      )}
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        data-testid="create-sticky-button"
        disabled={disabled}
        onClick={onCreateSticky}
        style={{
          ...BUTTON_BASE,
          backgroundColor: '#FFF59D',
          color: '#5f5324',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
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
