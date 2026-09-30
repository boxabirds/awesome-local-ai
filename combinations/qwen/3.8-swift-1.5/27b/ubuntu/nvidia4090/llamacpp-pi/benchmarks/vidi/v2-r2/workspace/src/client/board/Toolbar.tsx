interface ToolbarProps {
  onCreateSticky(): void;
  /** When true the Sticky note button is disabled (board cannot be loaded). */
  disabled?: boolean;
}

/**
 * Fixed left-side toolbar. The Sticky note button creates a note at the centre
 * of the visible board area (see App). Clicks stop propagation so the
 * viewport never pans or clears the selection.
 */
export function Toolbar({ onCreateSticky, disabled = false }: ToolbarProps) {
  return (
    <div
      data-testid="toolbar"
      className="toolbar"
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
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title={disabled ? 'Board unavailable' : 'Sticky note – or double-click the board'}
        disabled={disabled}
        onClick={onCreateSticky}
        style={{
          width: 36,
          height: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 6,
          background: disabled ? '#E5E7EB' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: disabled ? 'none' : '0 1px 3px rgba(0,0,0,0.2)',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <rect x="1" y="1" width="16" height="16" rx="1" fill="#FFF59D" stroke="#c9a227" />
          <path d="M12 14 L14 16 L16 14 Z" fill="#fff" stroke="#c9a227" strokeWidth="0.5" />
          <line x1="4" y1="6" x2="14" y2="6" stroke="#8a6d1a" strokeWidth="1" />
          <line x1="4" y1="9" x2="14" y2="9" stroke="#8a6d1a" strokeWidth="1" />
          <line x1="4" y1="12" x2="10" y2="12" stroke="#8a6d1a" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
