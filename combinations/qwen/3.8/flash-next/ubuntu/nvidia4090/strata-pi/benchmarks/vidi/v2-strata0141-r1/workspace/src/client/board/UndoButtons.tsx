import { useCallback } from 'react';

/**
 * Undo and Redo (`undo.controls`).
 *
 * Two buttons, and both are disabled when there is nothing this person can take
 * back or put back: the state comes from the stacks, not from what is on screen,
 * so an empty board, a board whose every change came from someone else, and a
 * board that has been undone to its start all look the same - grey buttons.
 *
 * The accessible name is the action, the tooltip is the shortcut, and the
 * keyboard does the same thing (`useBoardKeys`), because nobody reaches for a
 * mouse when they have just made a mistake.
 */
export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

const UNDO_TITLE = 'Undo (Ctrl/Cmd+Z)';
const REDO_TITLE = 'Redo (Ctrl/Cmd+Shift+Z)';

/** A curved arrow: back, and forward. */
function ArrowIcon({ forward }: { forward: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d={forward ? 'M4 15c3-6 9-8 13-6M17 3v6h-6' : 'M20 15c-3-6-9-8-13-6M7 3v6h6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UndoButtons(props: UndoButtonsProps) {
  const { canUndo, canRedo, undo, redo } = props;

  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className="toolbar__group undo-controls"
      data-testid="undo-controls"
      role="group"
      aria-label="Undo and redo"
      onPointerDown={stop}
      onClick={stop}
    >
      <button
        type="button"
        className="toolbar__button"
        data-testid="undo"
        aria-label="Undo"
        title={canUndo ? UNDO_TITLE : 'Nothing of yours to undo'}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        <ArrowIcon forward={false} />
        <span className="toolbar__label">Undo</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="redo"
        aria-label="Redo"
        title={canRedo ? REDO_TITLE : 'Nothing to redo'}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        <ArrowIcon forward />
        <span className="toolbar__label">Redo</span>
      </button>
    </div>
  );
}
