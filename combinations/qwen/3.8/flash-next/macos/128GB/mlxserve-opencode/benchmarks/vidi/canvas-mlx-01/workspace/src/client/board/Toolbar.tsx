import type { JSX, PointerEvent } from 'react';

export interface ToolbarProps {
  /** Create a sticky note centred in the visible board area and start editing it. */
  onCreateSticky(): void;
}

/** The tooltip / title text for the create button (exact PRD wording). */
export const STICKY_NOTE_TOOLTIP = 'Sticky note – or double-click the board';

/**
 * The fixed left-side toolbar. It holds the Sticky note button. Pointer events are
 * stopped so a click here never reaches the board behind it (which would clear the
 * selection or start a pan).
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const stop = (event: PointerEvent): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="vidi-toolbar"
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={stop}
    >
      <button
        type="button"
        className="vidi-toolbar-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_NOTE_TOOLTIP}
        onClick={props.onCreateSticky}
      >
        {/* a small sticky-note glyph */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 3h9l3 3v11H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M13 3v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
