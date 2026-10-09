import type { ReactElement } from 'react';
/**
 * Left toolbar with the Sticky note button.
 */
export function Toolbar(props: { onCreateSticky(): void }): ReactElement {
  return (
    <div
      className="toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 20,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
        style={{
          width: 40,
          height: 40,
          fontSize: 18,
          borderRadius: 8,
          border: '1px solid #d5d9e0',
          background: '#FFF59D',
          cursor: 'pointer',
        }}
      >
        +
      </button>
    </div>
  );
}
