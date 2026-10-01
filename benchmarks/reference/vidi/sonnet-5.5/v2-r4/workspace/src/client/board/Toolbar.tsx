import type { ReactNode } from 'react';

export function Toolbar(props: { onCreateSticky(): void; disabled?: boolean; children?: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: 20,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
        style={{ width: 40, height: 40, border: 'none', background: 'transparent', borderRadius: 8, cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.4 : 1 }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#FFF59D" stroke="#444" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16v10l-6 6H4z" />
          <path d="M14 20v-6h6" fill="none" />
        </svg>
      </button>
      {props.children}
    </div>
  );
}
