/**
 * The Undo and Redo buttons (story 8).
 *
 * They live in the left toolbar, under the tools, because they are the other thing a person does to
 * the board rather than a thing the board is made of. Their only job is to say whether there is
 * anything of *this person's* to take back or put back, and to ask for it when clicked: the history
 * they act on belongs to this tab and holds nothing that anybody else wrote, so the button never
 * offers to reverse a colleague's work.
 *
 * A disabled button is the whole of the "nothing to undo" story: the PRD asks that availability be
 * visible rather than discovered by pressing. `disabled` is the attribute that takes the button out
 * of the tab order and stops the click, and `aria-disabled` is set alongside it because the toolbar's
 * other button does the same and because a screen reader announces the one, not the other.
 */

import type { UndoActions } from './useUndo';

/** Tooltip of the Undo button (exact product text). */
export const UNDO_BUTTON_HINT = 'Undo (Ctrl/Cmd+Z)';
/** Tooltip of the Redo button (exact product text). */
export const REDO_BUTTON_HINT = 'Redo (Ctrl/Cmd+Shift+Z)';

/** What the two buttons need: the answers of `useUndo`, and nothing else. */
export interface UndoButtonsProps extends UndoActions {
  /**
   * Why the buttons cannot be used when the reason is not that the history is empty — a board the room
   * cannot read. It goes on the button instead of the shortcut, for the same reason the Sticky note
   * button says it: a control that stops working in silence is a bug report waiting to be written.
   */
  unavailable?: string;
}

/** The two buttons, as a pair: what is undone and what is put back are one decision. */
export function UndoButtons({
  canUndo,
  canRedo,
  undo,
  redo,
  unavailable,
}: UndoButtonsProps): React.JSX.Element {
  return (
    <>
      <button
        aria-disabled={canUndo ? undefined : 'true'}
        aria-label="Undo"
        className="toolbar-button"
        data-testid="undo"
        disabled={!canUndo}
        title={unavailable ?? UNDO_BUTTON_HINT}
        type="button"
        onClick={undo}
      >
        <span aria-hidden="true" className="toolbar-icon">
          {'↺'}
        </span>
        <span className="toolbar-label">Undo</span>
      </button>
      <button
        aria-disabled={canRedo ? undefined : 'true'}
        aria-label="Redo"
        className="toolbar-button"
        data-testid="redo"
        disabled={!canRedo}
        title={unavailable ?? REDO_BUTTON_HINT}
        type="button"
        onClick={redo}
      >
        <span aria-hidden="true" className="toolbar-icon">
          {'↻'}
        </span>
        <span className="toolbar-label">Redo</span>
      </button>
    </>
  );
}
