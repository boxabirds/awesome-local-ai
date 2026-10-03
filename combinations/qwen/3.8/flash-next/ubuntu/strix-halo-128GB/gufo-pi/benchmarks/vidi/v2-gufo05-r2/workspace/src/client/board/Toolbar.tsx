export interface ToolbarProps {
  onCreateSticky(): void;
}

/** Exact tooltip shown on the Sticky note button (PRD wording). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

/**
 * The fixed left-side tool rail. This story adds the "Sticky note" creation
 * button; later stories add more tools here.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div
      className="toolbar"
      data-testid="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar__button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        data-testid="sticky-note-button"
        onClick={onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 3h9l4 4v10H4V3Zm8 0v5h5M6 9h8M6 12h8M6 15h5"
            stroke="currentColor"
            strokeWidth="1.3"
            fillOpacity="0.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
