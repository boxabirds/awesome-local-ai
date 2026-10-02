import { STICKY_COLORS } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * Fixed left-side toolbar with the Sticky note button.
 * Tooltip (and accessible name): "Sticky note – or double-click the board".
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div
      data-testid="toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-button"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.15)',
          background: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'block',
            position: 'relative',
            width: 20,
            height: 20,
            background: STICKY_COLORS.yellow,
            border: '1px solid rgba(0,0,0,0.3)',
            borderRadius: 2,
          }}
        >
          <span
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              borderStyle: 'solid',
              borderWidth: '0 0 8px 8px',
              borderColor: 'transparent transparent rgba(0,0,0,0.18) transparent',
            }}
          />
        </span>
      </button>
    </div>
  );
}
