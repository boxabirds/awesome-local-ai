/**
 * The two buttons that say whether there is anything to undo.
 *
 * The PRD's fourth problem was that undo's availability is invisible: a person who cannot tell whether
 * the board will take a keystroke back presses it hopefully, or not at all. These buttons are the answer
 * to that, which makes their disabled state as important as their click handler — a button that looks
 * available and does nothing is the thing the story is here to stop.
 *
 * So the two rules that decide `disabled` are the two honest ones: there is nothing of *mine* in the
 * history (`canUndo`, which is the history's own answer, and is false on a board I have only ever
 * watched), or this board cannot be written to at all (`canEdit`, which on a board that failed to load
 * means an undo would be written into a document that is about to be thrown away). Nothing else is
 * consulted, in particular not the length of the board's history: what another person did is not
 * something these buttons know about, and must not become something they appear to offer.
 *
 * The arrows are drawn with borders rather than loaded, as the rest of this app's icons are; the words
 * are the accessible name, and the tooltip is where the shortcut is written down, because a keyboard
 * shortcut is only useful to somebody who knows it exists.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { UndoBinding } from './useUndo';

/** What the PRD asks the tooltips to say, shortcut included. */
export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export type UndoButtonsProps = UndoBinding;

export function UndoButtons({ canUndo, canRedo, canEdit, undo, redo }: UndoButtonsProps): JSX.Element {
  /** A click here is a command, not a board gesture: no pan, no deselect. */
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div className="toolbar__group" data-testid="undo-buttons" onPointerDown={stop}>
      <Button
        testId="undo"
        label="Undo"
        tooltip={canEdit ? UNDO_TOOLTIP : `${UNDO_TOOLTIP} — unavailable until this board is loaded`}
        arrow="↶"
        enabled={canUndo && canEdit}
        act={undo}
      />
      <Button
        testId="redo"
        label="Redo"
        tooltip={canEdit ? REDO_TOOLTIP : `${REDO_TOOLTIP} — unavailable until this board is loaded`}
        arrow="↷"
        enabled={canRedo && canEdit}
        act={redo}
      />
    </div>
  );
}

interface ButtonProps {
  testId: string;
  label: string;
  tooltip: string;
  arrow: string;
  enabled: boolean;
  act(): void;
}

/** One of the two, because their only difference is which way they point and which stack they read. */
function Button({ testId, label, tooltip, arrow, enabled, act }: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="toolbar__button"
      data-testid={testId}
      aria-label={label}
      title={tooltip}
      disabled={!enabled}
      aria-disabled={!enabled}
      onClick={() => {
        // Disabled by attribute and refused again: on a board that cannot be written to there is nothing
        // for these to do, and a click that reached the history anyway would be a write nobody asked for.
        if (!enabled) return;
        act();
      }}
    >
      <span className="toolbar__arrow" aria-hidden="true">
        {arrow}
      </span>
      <span className="toolbar__label">{label}</span>
    </button>
  );
}
