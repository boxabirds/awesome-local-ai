import type { JSX } from 'react';

/**
 * Accessible name and tooltip of the creation button (the tooltip also states
 * the double-click alternative; PRD accessibility constraint).
 */
export const CREATE_STICKY_LABEL = 'Sticky note';

/**
 * Left creation toolbar (sticky.create_button). Only the sticky note tool
 * exists today; buttons are added here when later object stories land.
 */
export function Toolbar({ onCreateSticky }: { onCreateSticky(): void }): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky"
        aria-label={CREATE_STICKY_LABEL}
        title={`${CREATE_STICKY_LABEL} — or double-click the board`}
        onClick={onCreateSticky}
      >
        {/* A note with a folded corner. */}
        <svg
          aria-hidden="true"
          focusable="false"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="currentColor"
            d="M2.5 2h11v8.2L10.2 14h-7.7V2Zm9 8h2.5l-2.5 2.4V10ZM4.5 4.5v1.6h7V4.5h-7Zm0 3v1.6h4.5v-1.6H4.5Z"
          />
        </svg>
      </button>
    </div>
  );
}
