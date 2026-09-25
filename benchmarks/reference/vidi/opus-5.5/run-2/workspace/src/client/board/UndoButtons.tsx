/** Undo and Redo buttons of the left toolbar (anchor: undo.buttons). */
import type { UndoApi } from './useUndo';

export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export function UndoButtons(props: UndoApi): React.JSX.Element {
  return (
    <div className="undo-buttons" role="group" aria-label="History">
      <button type="button" aria-label="Undo" title={UNDO_TOOLTIP} disabled={!props.canUndo} onClick={props.undo}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
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
      <button type="button" aria-label="Redo" title={REDO_TOOLTIP} disabled={!props.canRedo} onClick={props.redo}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
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
