import type { CSSProperties, JSX } from 'react';

const buttonStyle: CSSProperties = {
  width: 44,
  height: 44,
  border: 'none',
  background: '#f3f4f6',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1
};

export interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

export function UndoButtons(props: UndoButtonsProps): JSX.Element {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        style={{ ...buttonStyle, opacity: props.canUndo ? 1 : 0.45, cursor: props.canUndo ? 'pointer' : 'default' }}
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        ↩
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        style={{ ...buttonStyle, opacity: props.canRedo ? 1 : 0.45, cursor: props.canRedo ? 'pointer' : 'default' }}
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        ↪
      </button>
    </>
  );
}
