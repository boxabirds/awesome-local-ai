export function Toolbar(props: { onCreateSticky(): void }) {
  return (
    <div
      className="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16v10l-6 6H4zM14 20v-6h6" />
        </svg>
      </button>
    </div>
  );
}
