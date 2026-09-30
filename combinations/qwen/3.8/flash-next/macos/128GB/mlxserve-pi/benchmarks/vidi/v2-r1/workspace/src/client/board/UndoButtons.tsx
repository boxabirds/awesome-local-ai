// Undo and Redo on the tool rail (`undo.controls`).
//
// Two buttons that act on nothing but this tab's own controller: their enabled state
// comes from `useUndo`, which is already false for a board that cannot be edited, so
// a viewer sees two dead buttons (kept in place, like the sticky tool, rather than
// removed — the rail stays where people learned it is). The tooltip carries the
// shortcut so it is discoverable without reading the source.

import { type CSSProperties, type ReactNode } from 'react';

/** Exact tooltip text (undo.controls contract). */
export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 4,
  paddingTop: 6,
  borderTop: '1px solid rgba(0, 0, 0, 0.10)',
};

const glyphStyle: CSSProperties = {
  fontSize: 18,
  lineHeight: 1,
};

/** The Undo / Redo pair, rendered inside the board's tool rail. */
export function UndoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: UndoButtonsProps): ReactNode {
  return (
    <div
      data-testid="undo-buttons"
      role="group"
      aria-label="Undo and redo"
      style={rowStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-testid="undo-button"
        aria-label="Undo"
        title={UNDO_TOOLTIP}
        className="vidi6-icon-button"
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={onUndo}
      >
        <span style={glyphStyle} aria-hidden="true">
          &#8617;
        </span>
      </button>
      <button
        type="button"
        data-testid="redo-button"
        aria-label="Redo"
        title={REDO_TOOLTIP}
        className="vidi6-icon-button"
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={onRedo}
      >
        <span style={glyphStyle} aria-hidden="true">
          &#8618;
        </span>
      </button>
    </div>
  );
}
