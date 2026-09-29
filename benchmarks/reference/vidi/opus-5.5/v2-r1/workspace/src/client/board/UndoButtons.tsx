import type { useUndo } from './useUndo';

export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/** Undo and Redo, below the tools in the left toolbar; disabled when their history is empty. */
export function UndoButtons(props: ReturnType<typeof useUndo>) {
  return (
    <>
      <span className="toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="toolbar-button"
        aria-label="Undo"
        title={UNDO_TOOLTIP}
        disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
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
        className="toolbar-button"
        aria-label="Redo"
        title={REDO_TOOLTIP}
        disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
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
    </>
  );
}
