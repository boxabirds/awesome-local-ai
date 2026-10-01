interface Props {
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 4,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        style={{ width: 40, height: 40, padding: 0, cursor: 'pointer', background: 'none', border: 'none' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3h18v12l-6 6H3z" fill="#FFF59D" stroke="#444" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M15 21v-6h6" fill="none" stroke="#444" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
