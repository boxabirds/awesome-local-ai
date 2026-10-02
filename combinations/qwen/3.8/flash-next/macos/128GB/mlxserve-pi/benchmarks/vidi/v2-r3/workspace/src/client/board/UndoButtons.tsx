import type { JSX } from 'react';
import type { UndoActions } from './useUndo';

export type UndoButtonsProps = UndoActions;

/**
 * The Undo and Redo buttons of the board toolbar.
 *
 * They say what *this person's* history holds and nothing else: the stacks they
 * read belong to this tab alone, so a button stays disabled while the only
 * changes on the board are somebody else's, and it never becomes enabled because
 * somebody else did something. When there is nothing to do the button is
 * `disabled` (and says so in `aria-disabled`, for the assistive technology that
 * reads a greyed button at all), which is also why the shortcuts and the buttons
 * agree: both are given the same two answers.
 *
 * The tooltip carries the shortcut, because the shortcut is the faster way of
 * doing the same thing and a person should not have to know it exists separately.
 */
export function UndoButtons(props: UndoButtonsProps): JSX.Element {
  return (
    <>
      <button
        type="button"
        className="toolbar-button toolbar-undo-button"
        data-testid="undo-button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!props.canUndo}
        aria-disabled={props.canUndo ? undefined : 'true'}
        onClick={() => {
          props.undo();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path
            d="M6.5 4.5 3 8l3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 8h7.5a3.5 3.5 0 0 1 0 7H8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button toolbar-redo-button"
        data-testid="redo-button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
        disabled={!props.canRedo}
        aria-disabled={props.canRedo ? undefined : 'true'}
        onClick={() => {
          props.redo();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <path
            d="M11.5 4.5 15 8l-3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 8H7.5a3.5 3.5 0 0 0 0 7H10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </>
  );
}
