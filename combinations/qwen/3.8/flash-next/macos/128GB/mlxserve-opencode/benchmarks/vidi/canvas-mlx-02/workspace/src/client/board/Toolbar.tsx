// Left-side fixed toolbar (story 2) with the "Sticky note" creation button.
import type React from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * True only while the board cannot be edited at all (story 4: the room could
   * not load it). A disabled button is inert and says so to assistive tech.
   */
  disabled?: boolean;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { onCreateSticky, disabled = false } = props;
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
        disabled={disabled}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onCreateSticky}
        style={{
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid #e0c84a',
          background: '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 20,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {/* Simple sticky-note glyph. */}
        <span aria-hidden="true">🗒</span>
      </button>
    </div>
  );
}
