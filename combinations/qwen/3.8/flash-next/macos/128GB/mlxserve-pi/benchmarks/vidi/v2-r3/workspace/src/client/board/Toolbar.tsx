import type { JSX, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface ToolbarProps {
  /** Create a note at the centre of the visible board area and edit it. */
  onCreateSticky(): void;
  /** False only while the board cannot be edited (a board that failed to
   * load): the Sticky note button is disabled, so a click creates nothing.
   */
  disabled?: boolean;
}

/**
 * The left-side board toolbar. Its Sticky note button always works, whatever
 * the board is empty or panned far away (the app turns the click into a world
 * point at the centre of the visible area).
 *
 * Pointer events are stopped here so a click on a tool never reaches the
 * viewport, which would read it as a click on empty board space and clear the
 * selection.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const stop = (e: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  return (
    <aside
      className="toolbar"
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar-button toolbar-sticky-note-button"
        data-testid="sticky-note-button"
        aria-label="Sticky note"
        aria-disabled={props.disabled ? 'true' : undefined}
        disabled={props.disabled === true}
        title="Sticky note – or double-click the board"
        onClick={() => {
          props.onCreateSticky();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path
            d="M2.5 2.5h13v9l-4 4h-9z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M15.5 11.5h-4v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
    </aside>
  );
}
