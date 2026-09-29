// The two undo buttons (design `undo.controls`).
//
// They are the only visible sign of a history that belongs to one person on one
// board: what they report is *this tab's* stacks, so five people on one board each
// see a different pair. Mine is grey because I have done nothing here, not because
// nobody has.
//
// `disabled` is set from `aria-disabled` as well as the attribute: the first is what
// stops the click, the second is what a screen reader reads out, and both should be
// true of a button that has nothing to do (TC-18).

export interface UndoButtonsProps {
  /** This tab has a step of its own to reverse. */
  canUndo: boolean;
  /** This tab has a step it has just undone, and nothing since. */
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

const BUTTON: React.CSSProperties = {
  width: 40,
  height: 32,
  border: '1px solid #d6d9de',
  background: '#ffffff',
  borderRadius: 8,
  fontSize: 16,
  lineHeight: '30px',
  color: '#2c2f36',
  padding: 0,
};

function buttonStyle(enabled: boolean): React.CSSProperties {
  return {
    ...BUTTON,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.45,
  };
}

/**
 * Undo and redo, side by side, sized for the board's left tool bar. Clicks stop
 * propagation so they never reach the viewport behind the bar (which would clear the
 * selection).
 */
export function UndoButtons(props: UndoButtonsProps) {
  const stop = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) =>
    e.stopPropagation();
  return (
    <div
      data-testid="undo-buttons"
      role="group"
      aria-label="Undo history"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <button
        type="button"
        aria-label="Undo"
        data-testid="undo-button"
        title="Undo my last change – Ctrl/Cmd+Z"
        onClick={props.onUndo}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo || undefined}
        style={buttonStyle(props.canUndo)}
      >
        {/* a counter-clockwise arrow */}
        <span aria-hidden>&#8630;</span>
      </button>
      <button
        type="button"
        aria-label="Redo"
        data-testid="redo-button"
        title="Redo – Ctrl/Cmd+Shift+Z"
        onClick={props.onRedo}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo || undefined}
        style={buttonStyle(props.canRedo)}
      >
        {/* a clockwise arrow */}
        <span aria-hidden>&#8631;</span>
      </button>
    </div>
  );
}
