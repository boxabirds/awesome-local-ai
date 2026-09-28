// The fixed left-side toolbar (story 2, sticky.toolbar) with the Sticky note
// button. Clicks never propagate to the viewport (which would pan/clear).

import type { ReactElement } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

/** The left toolbar: the Sticky note tool, and below it the Undo and Redo
 *  buttons (story 8, undo.buttons). */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  undo: UndoApi;
}): ReactElement {
  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 3h14v9l-5 5H3V3z" fill="#FFF59D" stroke="#94a3b8" strokeWidth="1" />
          <path d="M12 17v-5h5" fill="none" stroke="#94a3b8" strokeWidth="1" />
        </svg>
      </button>
      <UndoButtons {...props.undo} />
    </div>
  );
}
