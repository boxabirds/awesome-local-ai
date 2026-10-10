import type { JSX } from 'react';

import type { UndoActions } from './useUndo';

/**
 * Accessible names and tooltips (PRD accessibility constraint: the tooltip also
 * carries the shortcut, so a control can be found by keyboard without a manual).
 */
export const UNDO_LABEL = 'Undo';
export const REDO_LABEL = 'Redo';
export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/** Exactly what `useUndo` answers: the two buttons read no more than this. */
export type UndoButtonsProps = UndoActions;

/**
 * Undo and Redo in the left toolbar, under the tools (`undo.controls`).
 *
 * They are the sight of a history that belongs to this person alone: the two
 * stacks they act on hold nothing but what this tab has written, so the button
 * says "undo my last thing on this board", never "undo the last thing that
 * happened". It is disabled when this person's history is empty and when the
 * board cannot be written to, and `aria-disabled` travels with `disabled` so a
 * screen reader hears the reason rather than an absence.
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps): JSX.Element {
  return (
    <>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="undo-button"
        aria-label={UNDO_LABEL}
        title={UNDO_TOOLTIP}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        {/* A bent arrow pointing back over the shoulder. */}
        <svg
          aria-hidden="true"
          focusable="false"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="currentColor"
            d="M6.6 2.6 2.3 6.9l4.3 4.3V8.6h3c1.4 0 2.5 1.1 2.5 2.5v1.2h1.7v-1.2c0-2.3-1.9-4.2-4.2-4.2h-3V2.6Z"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="redo-button"
        aria-label={REDO_LABEL}
        title={REDO_TOOLTIP}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        {/* The same arrow, mirrored. */}
        <svg
          aria-hidden="true"
          focusable="false"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="currentColor"
            d="M9.4 2.6l4.3 4.3-4.3 4.3V8.6h-3c-1.4 0-2.5 1.1-2.5 2.5v1.2H2.2v-1.2c0-2.3 1.9-4.2 4.2-4.2h3V2.6Z"
          />
        </svg>
      </button>
    </>
  );
}
