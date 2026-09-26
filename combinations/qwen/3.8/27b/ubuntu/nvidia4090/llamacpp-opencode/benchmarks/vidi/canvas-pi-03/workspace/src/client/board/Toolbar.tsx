import type { ReactElement, SyntheticEvent } from 'react';

export interface ToolbarProps {
  /** Creates a sticky note at the centre of the visible board area. */
  onCreateSticky(): void;
  /** Story 4: disabled while the board failed to load (load_failed). */
  disabled?: boolean;
}

/**
 * Fixed left-side toolbar (story 2). Currently holds the Sticky note button.
 * Stops pointer propagation so clicks never reach the viewport (which would
 * pan or clear the selection).
 */
export function Toolbar(props: ToolbarProps): ReactElement {
  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      data-testid="toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
      onPointerUp={stop}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        zIndex: 10,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-button"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          padding: 0,
          borderRadius: 8,
          border: '1px solid rgba(0, 0, 0, 0.15)',
          background: '#FFF59D',
          cursor: props.disabled ? 'default' : 'pointer',
          opacity: props.disabled ? 0.5 : 1,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 4h16v11l-5 5H4V4z" fill="rgba(255, 255, 255, 0.6)" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="1.5" />
          <path d="M15 20v-5h5" fill="rgba(0, 0, 0, 0.12)" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  );
}
