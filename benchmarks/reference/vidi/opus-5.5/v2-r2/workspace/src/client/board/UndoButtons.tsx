import type { useUndo } from './useUndo';

export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

/** Undo and Redo buttons for the left toolbar, disabled while their history is empty. */
export function UndoButtons(props: ReturnType<typeof useUndo>): React.JSX.Element {
  return (
    <>
      <button type="button" aria-label="Undo" title={UNDO_TOOLTIP} disabled={!props.canUndo}
        aria-disabled={!props.canUndo} onClick={props.undo}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
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
      <button type="button" aria-label="Redo" title={REDO_TOOLTIP} disabled={!props.canRedo}
        aria-disabled={!props.canRedo} onClick={props.redo}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
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
