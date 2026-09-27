// Left-side board toolbar (see spec: sticky.toolbar).
// Fixed position; the Sticky note button creates a note at the centre of the
// visible board area and starts editing it.

import type { JSX } from 'react';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** False while the board is load_failed: the button is disabled. */
  disabled?: boolean;
}

export function Toolbar({ onCreateSticky, disabled = false }: ToolbarProps): JSX.Element {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-testid="toolbar"
      className="toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        onClick={onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v9l-5 5H3V3zm11 11.5L15.5 14H14V11.5h-1.5V14H3v-11h11v7.5z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
