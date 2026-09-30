import React from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** When true the create button is disabled (e.g. the board failed to load). */
  disabled?: boolean;
}

/**
 * Left-side creation toolbar. Pointer events are stopped here so a click never
 * reaches the viewport (which would pan the board or clear the selection).
 */
export function Toolbar({ onCreateSticky, disabled = false }: ToolbarProps) {
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
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
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
    </div>
  );
}
