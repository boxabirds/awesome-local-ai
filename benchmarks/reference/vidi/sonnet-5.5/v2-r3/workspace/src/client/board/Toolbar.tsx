export function Toolbar(props: { onCreateSticky(): void }) {
  return (
    <div
      className="left-toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 4h16v10l-6 6H4z" />
          <path d="M14 20v-6h6" />
        </svg>
      </button>
    </div>
  );
}
