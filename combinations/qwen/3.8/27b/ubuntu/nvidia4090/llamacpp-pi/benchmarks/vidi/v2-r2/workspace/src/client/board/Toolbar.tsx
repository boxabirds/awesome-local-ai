import { type JSX } from 'react';
import { STICKY_COLORS } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { UndoActions } from './useUndo';

export interface ToolbarProps {
  /** Create a sticky note at the viewport centre. */
  onCreateSticky(): void;
  /**
   * When true (persist.client_status load_failed) the Sticky note button is
   * disabled, so a load-failed board can never create a note.
   */
  disabled?: boolean;
  /** Undo / Redo state and actions for this tab (story 8, undo.controls). */
  undo: UndoActions;
}

/**
 * Fixed left toolbar with the Sticky note button (story 2) and the Undo /
 * Redo buttons (story 8).
 *
 * It is rendered in screen space (outside the board's transformed world
 * layer) and stops pointer/double-click propagation so a press on it never
 * pans the board or creates a note.
 */
export function Toolbar({ onCreateSticky, disabled = false, undo }: ToolbarProps): JSX.Element {
  return (
    <div
      data-testid="sticky-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: 'rgba(255,255,255,0.94)',
        border: '1px solid #d8d8d0',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 2000,
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title={disabled ? 'Board unavailable' : 'Sticky note – or double-click the board'}
        disabled={disabled}
        data-testid="sticky-note-button"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          background: STICKY_COLORS.yellow,
          border: '1px solid rgba(0,0,0,0.18)',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            display: 'block',
            background: 'rgba(255,255,255,0.55)',
            border: '1.5px solid rgba(0,0,0,0.25)',
            borderRadius: 2,
          }}
        />
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
