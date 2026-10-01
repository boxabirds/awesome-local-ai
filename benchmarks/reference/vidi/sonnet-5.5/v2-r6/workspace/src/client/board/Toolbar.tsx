export function Toolbar(props: { onCreateSticky(): void }) {
  return (
    <div
      className="left-toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M4 4h16v10l-6 6H4z M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
