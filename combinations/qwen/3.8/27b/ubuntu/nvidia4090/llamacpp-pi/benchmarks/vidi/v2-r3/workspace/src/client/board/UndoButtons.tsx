import type { ReactElement } from 'react';

function Button(props: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick(): void;
  title?: string;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.title ?? props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        width: 40,
        height: 40,
        fontSize: 16,
        borderRadius: 8,
        border: '1px solid #d5d9e0',
        background: props.disabled ? '#e8eaee' : '#fff',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
        color: '#23272e',
      }}
    >
      {props.glyph}
    </button>
  );
}

/**
 * Story 8 (undo.controls): the Undo and Redo buttons for the left toolbar.
 * `aria-label` "Undo" / "Redo"; tooltips name the action and its shortcut.
 * Disabled when the stack is empty (`canUndo`/`canRedo`) or the board is not
 * editable (load_failed → `disabled`).
 */
export function UndoButtons(props: {
  canUndo: boolean;
  canRedo: boolean;
  disabled?: boolean;
  onUndo(): void;
  onRedo(): void;
}): ReactElement {
  return (
    <>
      <Button
        label="Undo"
        glyph="↶"
        disabled={props.disabled || !props.canUndo}
        title="Undo (Ctrl/Cmd+Z)"
        onClick={props.onUndo}
      />
      <Button
        label="Redo"
        glyph="↷"
        disabled={props.disabled || !props.canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={props.onRedo}
      />
    </>
  );
}
