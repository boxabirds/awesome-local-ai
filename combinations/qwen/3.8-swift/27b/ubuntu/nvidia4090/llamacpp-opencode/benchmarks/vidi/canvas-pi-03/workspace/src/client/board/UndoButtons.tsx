/**
 * Story 8: undo.controls — the Undo and Redo toolbar buttons.
 *
 * Left toolbar, below the tools (PRD structure). Accessible names "Undo" /
 * "Redo" with tooltips showing the shortcuts; `disabled` (and `aria-disabled`)
 * when the matching stack is empty or the board cannot be edited
 * (undo.buttons, undo.not_editable).
 */
import type { JSX } from 'react';
import type { UndoState } from './useUndo';

const BUTTON_STYLE: React.CSSProperties = {
  width: 40,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#ffffff',
  border: '1px solid #c9d1d9',
  borderRadius: 6,
  cursor: 'pointer',
  padding: 0,
};

const DISABLED_STYLE: React.CSSProperties = {
  opacity: 0.45,
  cursor: 'default',
};

export function UndoButtons(props: UndoState): JSX.Element {
  return (
    <div data-testid="undo-buttons" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        data-testid="undo-button"
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
        onClick={props.undo}
        style={{ ...BUTTON_STYLE, ...(!props.canUndo ? DISABLED_STYLE : {}) }}
      >
        {/* Curved arrow pointing left */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
          <path
            d="M6 8 L3 11 L6 14"
            stroke="#333"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 11 H12 A5 5 0 0 1 17 16"
            stroke="#333"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        data-testid="redo-button"
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
        onClick={props.redo}
        style={{ ...BUTTON_STYLE, ...(!props.canRedo ? DISABLED_STYLE : {}) }}
      >
        {/* Curved arrow pointing right */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
          <path
            d="M14 8 L17 11 L14 14"
            stroke="#333"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 11 H8 A5 5 0 0 0 3 16"
            stroke="#333"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
