/**
 * Story 2 · task 6 — the left tool palette (design "Toolbars: create, colour,
 * delete").
 *
 * A fixed vertical strip on the left of the board. Today it holds one tool:
 * the Sticky note button. Clicking it creates a note at the centre of the
 * visible board area (handled by the parent, which knows the camera). Pointer
 * events are stopped so a click never reaches the board surface underneath.
 */
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * True while the board is read-only (story 4: the connection reports
   * `load_failed`). The button is really `disabled`, so it is skipped by
   * keyboard and reported as such to assistive tech, not just inert.
   */
  disabled?: boolean;
}

/** Exact PRD tooltip / accessible description for the sticky-note button. */
export const STICKY_BUTTON_TITLE = 'Sticky note \u2013 or double-click the board';

export function Toolbar({ onCreateSticky, disabled = false }: ToolbarProps) {
  const stop = (event: ReactPointerEvent | MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="left-toolbar"
      data-testid="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
    >
      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TITLE}
        disabled={disabled}
        onPointerDown={stop}
        onClick={(event) => {
          stop(event);
          // Belt and braces: a disabled button never fires in a real browser,
          // but the handler is the thing that would change the document.
          if (disabled) return;
          onCreateSticky();
        }}
      >
        <span aria-hidden="true">{'\u{1F4DD}'}</span>
      </button>
    </div>
  );
}