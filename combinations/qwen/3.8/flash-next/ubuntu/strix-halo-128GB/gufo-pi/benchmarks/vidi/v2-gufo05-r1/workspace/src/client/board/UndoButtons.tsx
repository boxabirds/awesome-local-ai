/**
 * The Undo and Redo buttons (`undo.buttons`).
 *
 * They sit in the left toolbar under the tools, and they say what they are worth: a
 * button is disabled while its history is empty, or while the board cannot be edited,
 * so there is never a control that looks like it works and does nothing. The tooltip
 * carries the shortcut, which is the only place the keyboard combination is written
 * down — the PRD asks for that rather than a menu.
 *
 * A click goes to this tab's controller and nowhere else. That is the whole of the
 * personal scope: the stacks it reads were filled by this document's own transactions,
 * so clicking Undo here cannot reach anything another person did.
 */
import type { UndoHandle } from './useUndo';

/** The tooltips, with the shortcuts they stand for. */
export const UNDO_BUTTON_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_BUTTON_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/** A curved arrow: `dir` -1 points left (undo), +1 points right (redo). */
function Arrow({ dir }: { dir: -1 | 1 }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={dir === 1 ? 'translate(16, 0) scale(-1, 1)' : undefined}
      >
        <path d="M6 3.5 2.5 7 6 10.5" />
        <path d="M2.8 7h5.4a3.6 3.6 0 0 1 0 7.2H5" />
      </g>
    </svg>
  );
}

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoHandle) {
  return (
    <div className="toolbar__group" data-testid="undo-buttons">
      <button
        type="button"
        className="toolbar__button"
        data-testid="undo-button"
        aria-label="Undo"
        title={UNDO_BUTTON_TOOLTIP}
        disabled={!canUndo}
        onClick={undo}
      >
        <Arrow dir={-1} />
        <span>Undo</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="redo-button"
        aria-label="Redo"
        title={REDO_BUTTON_TOOLTIP}
        disabled={!canRedo}
        onClick={redo}
      >
        <Arrow dir={1} />
        <span>Redo</span>
      </button>
    </div>
  );
}
