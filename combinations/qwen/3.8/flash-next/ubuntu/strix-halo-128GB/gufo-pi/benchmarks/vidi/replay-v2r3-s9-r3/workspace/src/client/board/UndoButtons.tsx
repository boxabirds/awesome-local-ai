import React from 'react';

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

const UNDO_TOOLTIP = 'Undo (Ctrl/Cmd+Z)';
const REDO_TOOLTIP = 'Redo (Ctrl/Cmd+Shift+Z)';

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    border: 'none',
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: '#5f6368',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    fontSize: 18,
    lineHeight: 1,
  };
}

/**
 * Undo and Redo buttons for the left toolbar (story 8).
 *
 * Each button calls only this tab's controller, whose stacks hold only this
 * person's own LOCAL_ORIGIN steps. Buttons are disabled when the matching
 * history is empty or when the board cannot be edited.
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        title={UNDO_TOOLTIP}
        data-testid="undo-button"
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={undo}
        style={btnStyle(!canUndo)}
      >
        {/* Curved arrow left */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M7 5 3 9l4 4M3.5 9H12a4.5 4.5 0 0 1 0 9H8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title={REDO_TOOLTIP}
        data-testid="redo-button"
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={redo}
        style={btnStyle(!canRedo)}
      >
        {/* Curved arrow right */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M13 5l4 4-4 4M16.5 9H8a4.5 4.5 0 0 0 0 9h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
