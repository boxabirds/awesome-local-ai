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

/** What the PRD asks the tooltip to say, shortcut included. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note — or double-click the board';

export interface ToolbarProps {
  /** Add a note at the centre of the visible board and start typing. */
  onCreateSticky(): void;
}

export function Toolbar({ onCreateSticky }: ToolbarProps): JSX.Element {
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
        title={STICKY_NOTE_TOOLTIP}
        onClick={() => {
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
    </div>
  );
}
