import type { JSX } from 'react';
import type { UndoState } from './useUndo';

/** Shown when hovering the undo button; the shortcut is part of what the button is. */
export const UNDO_BUTTON_TOOLTIP = 'Undo \u2013 or Ctrl/Cmd + Z';
/** Shown when hovering the redo button. */
export const REDO_BUTTON_TOOLTIP = 'Redo \u2013 or Ctrl/Cmd + Shift + Z';

/**
 * The Undo and Redo buttons, under the tools.
 *
 * They are one person's history, not the board's: the buttons say what *this* tab can wind back,
 * and they are disabled when there is nothing of mine to wind back or when I am not allowed to
 * write at all. The tooltip carries the shortcut because the shortcut is the faster way to the
 * same thing, and a button that hides its own key is a button nobody learns.
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoState): JSX.Element {
  return (
    <div className="toolbar__history" data-testid="undo-buttons">
      <button
        type="button"
        className="toolbar__undo"
        data-testid="undo"
        aria-label="Undo"
        title={UNDO_BUTTON_TOOLTIP}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8Z"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__redo"
        data-testid="redo"
        aria-label="Redo"
        title={REDO_BUTTON_TOOLTIP}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M18.4 10.6C16.55 9 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6Z"
          />
        </svg>
      </button>
    </div>
  );
}
