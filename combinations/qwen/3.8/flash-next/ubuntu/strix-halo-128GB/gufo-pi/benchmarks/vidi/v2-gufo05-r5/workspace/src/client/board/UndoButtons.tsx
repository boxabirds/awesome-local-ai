/**
 * Undo and Redo (story 8).
 *
 * These are the only commands on the board that step backwards, so they show their state:
 * disabled and `aria-disabled` when there is nothing to step to, and the shortcut in the tooltip -
 * the keyboard is the normal way in (PRD: *Undo and Redo SHALL be available from the toolbar and
 * from the keyboard*). They are a strip of their own inside the toolbar, kept apart from the
 * creation button by a divider: one group makes things, the other takes steps back.
 */
import type { JSX } from 'react';

/** Tooltips exactly as the PRD words the shortcut, so the button teaches the keyboard. */
export const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
export const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

export interface UndoButtonProps {
  label: string;
  tooltip: string;
  icon: string;
  disabled: boolean;
  onClick(): void;
}

export function UndoButton({ label, tooltip, icon, disabled, onClick }: UndoButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="board-toolbar__button"
      data-testid={label === 'Undo' ? 'undo-button' : 'redo-button'}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      title={tooltip}
      onClick={() => {
        // a disabled button does not fire, but the guard also keeps the contract honest
        if (disabled) return;
        onClick();
      }}
    >
      {/* the glyph is decoration; the accessible name is the aria-label */}
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

export function UndoButtons({ canUndo, canRedo, onUndo, onRedo }: UndoButtonsProps): JSX.Element {
  return (
    <div className="board-toolbar__group" data-testid="undo-strip">
      <UndoButton
        label="Undo"
        tooltip={UNDO_TOOLTIP}
        icon="↶"
        disabled={!canUndo}
        onClick={onUndo}
      />
      <UndoButton
        label="Redo"
        tooltip={REDO_TOOLTIP}
        icon="↷"
        disabled={!canRedo}
        onClick={onRedo}
      />
    </div>
  );
}
