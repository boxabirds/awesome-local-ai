/**
 * Undo / Redo buttons for the left toolbar (story 8, undo.controls).
 *
 * `button[aria-label="Undo"]` / `button[aria-label="Redo"]` with tooltips
 * showing the shortcuts; natively disabled (and aria-disabled) when the
 * stack is empty or the board can't be edited (persist.client_status).
 */
import type { CSSProperties, JSX } from 'react';
import type { UndoActions } from './useUndo';

const BUTTON_STYLE: CSSProperties = {
  width: 40,
  height: 40,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid #d8d8d0',
  borderRadius: 6,
  cursor: 'pointer',
};

const DISABLED_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  cursor: 'default',
  opacity: 0.45,
};

function ArrowIcon({ flipped = false }: { flipped?: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={flipped ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoActions): JSX.Element {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        aria-disabled={!canUndo}
        data-testid="undo-button"
        onClick={undo}
        style={canUndo ? BUTTON_STYLE : DISABLED_STYLE}
      >
        <ArrowIcon />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!canRedo}
        aria-disabled={!canRedo}
        data-testid="redo-button"
        onClick={redo}
        style={canRedo ? BUTTON_STYLE : DISABLED_STYLE}
      >
        <ArrowIcon flipped />
      </button>
    </>
  );
}
