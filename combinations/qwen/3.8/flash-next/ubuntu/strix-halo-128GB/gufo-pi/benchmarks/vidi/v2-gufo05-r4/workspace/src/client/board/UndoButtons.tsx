/**
 * The undo and redo controls in the tool bar (`undo.buttons`).
 *
 * Each button is enabled exactly when there is a step behind it and disabled otherwise,
 * which is the whole of its feedback: it reflects this client's own history, so it goes
 * idle the moment there is nothing of theirs to reverse. The tooltip carries the keyboard
 * shortcut, because the buttons and Ctrl/Cmd+Z are the same command reached two ways.
 *
 * The buttons never read the selection or the document — they ask {@link useUndo}, which
 * already reports false on a board that cannot be written to (`undo.edit_lock`).
 */

import type { JSX } from 'react';
import type { UndoActions } from './useUndo';

export interface UndoButtonsProps {
  undo: UndoActions;
}

const stopPointer = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

export function UndoButtons(props: UndoButtonsProps): JSX.Element {
  const { undo } = props;

  return (
    <div className="vidi6-undo-group" data-vidi6="undo-group" onPointerDown={stopPointer}>
      <button
        type="button"
        className="vidi6-tool vidi6-tool-undo"
        data-vidi6="tool-undo"
        data-testid="undo-button"
        aria-label="Undo"
        disabled={!undo.canUndo}
        title="Undo (Ctrl/Cmd+Z)"
        onClick={undo.undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 5 3.5 8.5 7 12M3.8 8.5H12a4.5 4.5 0 0 1 0 9H8"
          />
        </svg>
      </button>
      <button
        type="button"
        className="vidi6-tool vidi6-tool-redo"
        data-vidi6="tool-redo"
        data-testid="redo-button"
        aria-label="Redo"
        disabled={!undo.canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={undo.redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 5 16.5 8.5 13 12M16.2 8.5H8a4.5 4.5 0 0 0 0 9h4"
          />
        </svg>
      </button>
    </div>
  );
}
