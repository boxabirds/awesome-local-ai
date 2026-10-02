/**
 * The left-hand toolbar, open to everyone: the only control in this story is
 * "Sticky note", which puts a note in the middle of the visible board and puts
 * its text straight into edit mode.
 *
 * It is a fixed overlay outside the world layer, so it does not pan or zoom and
 * stays reachable at any zoom level.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps) {
  return (
    <div className="toolbar" data-testid="toolbar" role="toolbar" aria-label="Board tools">
      <button
        type="button"
        className="toolbar__button"
        data-testid="tool-sticky-note"
        aria-label="Sticky note"
        title="Sticky note — adds a note in the centre and starts typing"
        onClick={onCreateSticky}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 3h10v7l-3 3H3V3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M13 10h-3v3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span>Sticky note</span>
      </button>
    </div>
  );
}
