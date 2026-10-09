import type { JSX } from 'react';
import type { UndoButtonState } from './useUndo';

/** Exact UI text (PRD: curved arrow icons, tooltips "Undo (Ctrl/Cmd+Z)" / "Redo (Ctrl/Cmd+Shift+Z)"). */
export const UNDO_BUTTON_LABEL = 'Undo';
export const REDO_BUTTON_LABEL = 'Redo';
export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export type UndoButtonsProps = UndoButtonState;

/**
 * Undo and redo in the left toolbar, under the Sticky note button. Both are present on every
 * board and disabled when there is nothing to do, so a board with nothing to undo says so
 * instead of hiding the button (`undo.buttons`).
 *
 * Clicking either one moves one step. A person who cannot edit cannot undo: the buttons are
 * disabled, the same rule the shortcuts follow.
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps): JSX.Element {
  return (
    <div className="vidi6-undo-buttons">
      <button
        type="button"
        className="vidi6-undo-button"
        data-testid="undo-button"
        aria-label={UNDO_BUTTON_LABEL}
        title={UNDO_BUTTON_TOOLTIP}
        onClick={undo}
        disabled={!canUndo}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="vidi6-undo-button"
        data-testid="redo-button"
        aria-label={REDO_BUTTON_LABEL}
        title={REDO_BUTTON_TOOLTIP}
        onClick={redo}
        disabled={!canRedo}
      >
        <RedoIcon />
      </button>
    </div>
  );
}

/** A curved arrow pointing back over the shoulder. */
function UndoIcon(): JSX.Element {
  return (
    <svg
      className="vidi6-undo-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5.5 3.5h4.2a2.8 2.8 0 0 1 0 5.6H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M7.4 1.6 4.1 3.9l3.3 2.3z" fill="currentColor" />
    </svg>
  );
}

/** The same arrow, mirrored. */
function RedoIcon(): JSX.Element {
  return (
    <svg
      className="vidi6-undo-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10.5 3.5H6.3a2.8 2.8 0 0 0 0 5.6h3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M8.6 1.6l3.3 2.3-3.3 2.3z" fill="currentColor" />
    </svg>
  );
}
