import type { JSX, ReactNode } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
  undoButtons: ReactNode;
}

const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

/**
 * Fixed left-side toolbar with the Sticky note button and undo/redo buttons.
 * The button creates a note at the centre of the visible board area (see App),
 * on top of all other notes, with text editing started immediately.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board toolbar"
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
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        data-testid="sticky-note-button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={props.onCreateSticky}
        style={{
          width: 40,
          height: 40,
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 8,
          background: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        <span aria-hidden>▪</span>
      </button>
      {props.undoButtons}
    </div>
  );
}
