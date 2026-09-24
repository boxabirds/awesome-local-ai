/**
 * Story 2 · task 6 — the left tool palette (design "Toolbars: create, colour,
 * delete"). Story 8 · task 5 adds the Undo / Redo buttons.
 *
 * A fixed vertical strip on the left of the board. It holds the Sticky-note
 * create tool and, since story 8, the two history buttons. Clicking create makes
 * a note at the centre of the visible board (the parent owns the camera); the
 * history buttons undo / redo *this person's* own steps and sit disabled while
 * the personal stack is empty (PRD undo.empty). Pointer events are stopped so a
 * click never reaches the board surface underneath.
 */
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * True while the board is read-only (story 4: the connection reports
   * `load_failed`). The buttons are really `disabled`, so they are skipped by
   * keyboard and reported as such to assistive tech, not just inert.
   */
  disabled?: boolean;
  /** Personal-history state for the Undo / Redo buttons (story 8). */
  history?: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo(): void;
    onRedo(): void;
  };
}

/** Exact PRD tooltip / accessible description for the sticky-note button. */
export const STICKY_BUTTON_TITLE = 'Sticky note \u2013 or double-click the board';

export function Toolbar({ onCreateSticky, disabled = false, history }: ToolbarProps) {
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
      {history ? (
        <UndoButtons
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.onUndo}
          onRedo={history.onRedo}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}