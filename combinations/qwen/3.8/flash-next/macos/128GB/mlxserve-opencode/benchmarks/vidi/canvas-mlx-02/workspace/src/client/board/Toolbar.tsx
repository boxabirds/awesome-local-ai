// Left-side fixed toolbar (story 2) with the "Sticky note" creation button.
import type React from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { onCreateSticky } = props;
  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: '#ffffff',
        border: '1px solid #e2e2e2',
        borderRadius: 12,
        boxShadow: '0 1px 6px rgba(0,0,0,0.1)',
        fontFamily: 'system-ui, sans-serif',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-create"
        onClick={onCreateSticky}
        style={{
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid #e0c84a',
          background: '#FFF59D',
          cursor: 'pointer',
          fontSize: 20,
        }}
      >
        {/* Simple sticky-note glyph. */}
        <span aria-hidden="true">🗒</span>
      </button>
    </div>
  );
}
