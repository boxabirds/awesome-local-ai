import type { JSX } from 'react';

export interface ToolbarProps {
  onCreateSticky: () => void;
}

/**
 * Fixed left-side toolbar with the Sticky note button.
 * Stops pointer propagation so clicks never reach the viewport
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
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-note-button"
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
    </div>
  );
}
