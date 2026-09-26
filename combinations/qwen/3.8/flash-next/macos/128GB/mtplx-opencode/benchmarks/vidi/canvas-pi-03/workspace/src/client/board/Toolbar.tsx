export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * The fixed left-side tool palette. Currently just the "Sticky note" creation
 * button. It stops pointer propagation so a click in the palette never reaches
 * the board (which would otherwise clear the selection or pan the camera).
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 6,
        background: '#ffffff',
        border: '1px solid rgba(17,17,17,0.12)',
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="create-sticky"
        onClick={() => onCreateSticky()}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          border: '1px solid rgba(0,0,0,0.25)',
          borderRadius: 8,
          background: '#FFF59D',
          fontSize: 20,
          color: '#111',
        }}
      >
        &#9634;
      </button>
    </div>
  );
}
