/**
 * Story 8 · task 5 — the Undo / Redo toolbar buttons (design "Toolbar undo /
 * redo buttons").
 *
 * Two buttons, disabled whenever the *personal* history has nothing to undo /
 * redo (PRD undo.empty). They render `disabled` for real, so assistive tech and
 * the keyboard both report them as unavailable, not merely inert.
 *
 * Presentational and independent: it takes the two booleans plus the two
 * handlers, and never reaches for the controller itself, so the same piece backs
 * the toolbar buttons and the Ctrl/Cmd+Z path — the toolbar just reflects the
 * same `canUndo` / `canRedo` the keyboard checks. Pointer-down is stopped so a
 * click never leaks to the board surface beneath.
 */
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** True while the board is read-only (`load_failed`) — both buttons inert. */
  disabled?: boolean;
}

function HistoryButton({
  testid,
  label,
  glyph,
  enabled,
  onClick,
}: {
  testid: string;
  label: string;
  glyph: string;
  enabled: boolean;
  onClick(): void;
}) {
  const stop = (event: ReactPointerEvent | MouseEvent) => event.stopPropagation();
  return (
    <button
      type="button"
      className="tool-button"
      data-testid={testid}
      aria-label={label}
      title={label}
      disabled={!enabled}
      onPointerDown={stop}
      onClick={(event) => {
        stop(event);
        if (!enabled) return; // disabled never fires; the handler is the mutation
        onClick();
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

export function UndoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  disabled = false,
}: UndoButtonsProps) {
  return (
    <div className="undo-buttons" data-testid="undo-buttons">
      <HistoryButton
        testid="undo-button"
        label="Undo"
        glyph={'\u21B6'}
        enabled={canUndo && !disabled}
        onClick={onUndo}
      />
      <HistoryButton
        testid="redo-button"
        label="Redo"
        glyph={'\u21B7'}
        enabled={canRedo && !disabled}
        onClick={onRedo}
      />
    </div>
  );
}