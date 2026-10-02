import type { UndoControls } from './useUndo';

/**
 * Undo/redo buttons for the left toolbar (story 8, PRD undo.ui).
 *
 * Rendered below the tool buttons. Disabled (and inert) while the matching
 * history is empty or the board is not editable (the gating already happens
 * in `useUndo`, which folds `canEdit` into `canUndo`/`canRedo`). Tooltips
 * advertise the keyboard shortcuts (undo.shortcuts).
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoControls): React.ReactElement {
  return (
    <div data-testid="undo-buttons" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <UndoButton
        ariaLabel="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        onClick={undo}
        glyph="↶"
      />
      <UndoButton
        ariaLabel="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!canRedo}
        onClick={redo}
        glyph="↷"
      />
    </div>
  );
}

function UndoButton(props: {
  ariaLabel: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  glyph: string;
}): React.ReactElement {
  const { ariaLabel, title, disabled, onClick, glyph } = props;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 40,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid #cfcfcf',
        borderRadius: 8,
        background: disabled ? '#f5f5f5' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
        {glyph}
      </span>
    </button>
  );
}
