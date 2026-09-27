export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * The fixed left-side board toolbar (design "sticky.toolbar"). Today it holds
 * the Sticky note button only. Its exact tooltip text is a product string.
 */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Board tools"
      data-testid="toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="toolbar__button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        data-testid="create-sticky"
        onClick={onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            d="M5 3h10l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
            fill="currentColor"
            opacity="0.25"
          />
          <path
            d="M15 3l4 4h-4V3z"
            fill="currentColor"
          />
        </svg>
        <span className="toolbar__button-label">Sticky note</span>
      </button>
    </div>
  );
}
