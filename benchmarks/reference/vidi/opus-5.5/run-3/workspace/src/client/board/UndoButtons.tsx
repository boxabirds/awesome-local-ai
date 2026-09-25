import type { useUndo } from './useUndo';

export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/** Undo and Redo buttons for the left toolbar; disabled while their history is empty or the board is locked. */
export function UndoButtons(props: ReturnType<typeof useUndo>) {
  return (
    <>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Undo"
        title={UNDO_TOOLTIP}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M7 5 3 9l4 4M3.5 9H12a4.5 4.5 0 0 1 0 9H9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Redo"
        title={REDO_TOOLTIP}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M13 5l4 4-4 4M16.5 9H8a4.5 4.5 0 0 0 0 9h3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
