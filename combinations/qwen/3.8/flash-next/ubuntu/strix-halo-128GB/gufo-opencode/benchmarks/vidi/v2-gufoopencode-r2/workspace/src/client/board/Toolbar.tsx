// Fixed left toolbar. The Sticky note button creates a note at the centre of
// the visible board area (the App resolves the viewport centre to world).

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
}

export function Toolbar({ onCreateSticky, disabled = false }: ToolbarProps): React.JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M2.5 2.5h13v10l-3 3h-10v-13Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M15.5 12.5h-3v3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span>Sticky note</span>
      </button>
    </div>
  );
}
