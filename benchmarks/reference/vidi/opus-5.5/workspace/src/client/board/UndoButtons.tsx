import type { UndoControls } from './useUndo';

export const UNDO_LABEL = 'Undo';
export const REDO_LABEL = 'Redo';
export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/** Undo (curved arrow left) and Redo (curved arrow right), below the tools in the left toolbar. */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoControls) {
  return (
    <div className="toolbar__group" role="group" aria-label="History">
      <button
        type="button"
        className="toolbar__button"
        aria-label={UNDO_LABEL}
        title={UNDO_TOOLTIP}
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__button"
        aria-label={REDO_LABEL}
        title={REDO_TOOLTIP}
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
