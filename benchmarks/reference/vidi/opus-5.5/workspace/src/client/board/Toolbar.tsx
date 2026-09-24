export const STICKY_BUTTON_LABEL = 'Sticky note';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited (its saved state could not be loaded). */
  disabled?: boolean;
}

/** Left-side vertical tool bar. */
export function Toolbar({ onCreateSticky, disabled = false }: ToolbarProps) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="toolbar__button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        onClick={onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 4h16v11l-5 5H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M20 15h-5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
