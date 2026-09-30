import { STICKY_COLORS } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky: () => void;
}

/**
 * Fixed left-side toolbar. Currently holds the "Sticky note" button, which
 * creates a note at the centre of the visible board. Pointer events stop
 * propagation so clicks never reach the viewport (which would pan/clear).
 */
export function Toolbar({ onCreateSticky }: ToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid #d0d0d0',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        zIndex: 20,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #cfcfcf',
          borderRadius: 8,
          background: '#fff',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            background: STICKY_COLORS.yellow,
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 3,
            display: 'block',
          }}
        />
      </button>
    </div>
  );
}
