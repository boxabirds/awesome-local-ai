export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited (story 4: it failed to load). */
  disabled?: boolean;
}

/**
 * Fixed left-side vertical tool bar. Currently one tool: "Sticky note". Clicks
 * stop propagation so they never reach the viewport (which would clear the
 * selection / start a pan).
 */
export function Toolbar(props: ToolbarProps) {
  const stop = (
    e: React.PointerEvent | React.MouseEvent | React.WheelEvent,
  ) => e.stopPropagation();
  return (
    <div
      data-testid="toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        data-testid="sticky-note-tool"
        title="Sticky note – or double-click the board"
        onClick={props.disabled ? undefined : props.onCreateSticky}
        disabled={props.disabled}
        aria-disabled={props.disabled || undefined}
        style={{
          width: 40,
          height: 40,
          border: 'none',
          background: '#FFF59D',
          borderRadius: 8,
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          opacity: props.disabled ? 0.45 : 1,
          fontSize: 20,
          lineHeight: '40px',
          color: '#5a4b00',
        }}
      >
        {/* a small sticky-note glyph */}
        <span aria-hidden>&#128221;</span>
      </button>
    </div>
  );
}
