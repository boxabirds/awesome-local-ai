/**
 * The board's own toolbar: the Sticky note button.
 *
 * Story 2 has one tool, so this is a narrow strip on the left edge (the design's
 * "toolbar strip, left side"). Everything in it must be nameable and clickable
 * without knowing what the icon means, so the button carries an accessible name
 * and a tooltip that also says the shortcut.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from '../../shared/config';
import { UndoButtons } from '../board/UndoButtons';
import type { UndoButtonsProps } from '../board/UndoButtons';

/** What the PRD asks the tooltip to say, shortcut included. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note — or double-click the board';

export interface ToolbarProps {
  /** Add a note at the centre of the visible board and start typing. */
  onCreateSticky(): void;
  /**
   * Take the button out of use: on a board that could not be loaded there is
   * nothing to add a note to, and a button that does nothing when pressed would be
   * a lie, so it says so instead (and `App` refuses the write anyway).
   */
  disabled?: boolean;
  /**
   * This person's undo history, as the buttons need it. Optional because the toolbar is drawn on boards
   * that have no history to show — a board that never opened has no document to have done anything to —
   * and a control that has nothing to report is left off rather than drawn lying.
   */
  undo?: UndoButtonsProps;
}

export function Toolbar({ onCreateSticky, disabled = false, undo }: ToolbarProps): JSX.Element {
  /** A click on the toolbar is a command, not a board gesture. */
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div className="toolbar" data-testid="toolbar" role="toolbar" aria-label="Board tools" onPointerDown={stop}>
      <button
        type="button"
        className="toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={disabled ? 'Sticky note — unavailable until this board is loaded' : STICKY_NOTE_TOOLTIP}
        disabled={disabled}
        aria-disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onCreateSticky();
        }}
      >
        {/* A folded-corner note, drawn in CSS: no icon font, no asset. It wears
            the same colour a new note is born with. */}
        <span
          className="toolbar__note-icon"
          aria-hidden="true"
          style={{ backgroundColor: STICKY_COLORS[DEFAULT_STICKY_COLOR] }}
        />
        <span className="toolbar__label">Sticky note</span>
      </button>
      {/* Below the tools, as the PRD puts them: they are not tools, they are the way back. */}
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
