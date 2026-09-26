import type { CSSProperties, ReactElement } from 'react';

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

const BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  padding: 0,
  borderRadius: 8,
  border: '1px solid rgba(0, 0, 0, 0.15)',
  background: 'rgba(255, 255, 255, 0.9)',
  cursor: 'pointer',
  color: 'rgba(0, 0, 0, 0.75)',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
};

/**
 * Undo / Redo buttons in the left toolbar (story 8, undo.controls).
 *
 * `aria-label` is the accessible name tests and screen readers key off; the
 * `title` doubles as the shortcut tooltip. The native `disabled` attribute
 * follows the controller's stack state (and the board's edit lock).
 */
export function UndoButtons(props: UndoButtonsProps): ReactElement {
  return (
    <div
      data-testid="undo-buttons"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        data-testid="undo-button"
        disabled={!props.canUndo}
        onClick={props.onUndo}
        style={{ ...BTN, cursor: props.canUndo ? 'pointer' : 'default', opacity: props.canUndo ? 1 : 0.4 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 7L4 12l5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 12h11a5 5 0 0 1 0 10h-1"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        data-testid="redo-button"
        disabled={!props.canRedo}
        onClick={props.onRedo}
        style={{ ...BTN, cursor: props.canRedo ? 'pointer' : 'default', opacity: props.canRedo ? 1 : 0.4 }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M15 7l5 5-5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 12H9a5 5 0 0 0 0 10h1"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
