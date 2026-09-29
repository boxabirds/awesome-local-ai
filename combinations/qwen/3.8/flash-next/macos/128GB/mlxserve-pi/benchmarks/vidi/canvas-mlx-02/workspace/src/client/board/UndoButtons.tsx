// Undo and Redo in the board's left toolbar (story 8, undo.controls).
//
// Two things this component is careful about, both of which are the whole point of
// the story rather than decoration:
//  * what it offers is this person's own history. The state comes from the
//    controller of THIS tab, whose stacks contain only this tab's own changes, so
//    a click can never step anyone else's work back;
//  * it says plainly when there is nothing to step back to. `disabled` (not just
//    a greyed-out look) means the button is inert and assistive tech reports it as
//    unavailable, which is also what happens on a board this client cannot edit.
import type React from 'react';
import type { UndoState } from './useUndo.ts';

export type UndoButtonsProps = UndoState;

const BUTTON_STYLE: React.CSSProperties = {
  width: 44,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid #d8d8d8',
  background: '#fafafa',
  fontSize: 17,
  color: '#202020',
};

function glyphStyle(disabled: boolean): React.CSSProperties {
  return {
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };
}

export function UndoButtons(props: UndoButtonsProps): React.JSX.Element {
  const { canUndo, canRedo, undo, redo } = props;
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        title="Undo previous change (Ctrl+Z, or Cmd+Z on a Mac)"
        data-testid="undo-button"
        disabled={!canUndo}
        aria-disabled={!canUndo}
        onClick={canUndo ? undo : undefined}
        style={{ ...BUTTON_STYLE, ...glyphStyle(!canUndo) }}
      >
        {/* Curved arrow back. */}
        <span aria-hidden="true">{'\u21A9'}</span>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo it again (Ctrl+Shift+Z or Ctrl+Y, or Cmd+Shift+Z on a Mac)"
        data-testid="redo-button"
        disabled={!canRedo}
        aria-disabled={!canRedo}
        onClick={canRedo ? redo : undefined}
        style={{ ...BUTTON_STYLE, ...glyphStyle(!canRedo) }}
      >
        {/* Curved arrow forward. */}
        <span aria-hidden="true">{'\u21AA'}</span>
      </button>
    </>
  );
}
