/**
 * Fixed left board toolbar. Today it holds the Sticky note button; later
 * stories add their tools here.
 */
export const BOARD_TOOLBAR_LABEL = "Board tools";
export const STICKY_NOTE_BUTTON_LABEL = "Sticky note";
export const STICKY_NOTE_BUTTON_TOOLTIP = "Sticky note \u2013 or double-click the board";

export interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label={BOARD_TOOLBAR_LABEL}
      aria-orientation="vertical"
      onPointerDown={(event) => {
        // A toolbar click must never reach the viewport (no pan, no deselect).
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="board-tool"
        data-testid="sticky-note-button"
        aria-label={STICKY_NOTE_BUTTON_LABEL}
        title={STICKY_NOTE_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="board-tool-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="18" height="18" focusable="false">
            <path d="M3 3h10v7.5L9.5 13H3V3z" fill="#FFF59D" stroke="currentColor" strokeWidth="1.2" />
            <path d="M9.5 13V10.5H13" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </span>
        <span className="board-tool-label">{STICKY_NOTE_BUTTON_LABEL}</span>
      </button>
    </div>
  );
}
