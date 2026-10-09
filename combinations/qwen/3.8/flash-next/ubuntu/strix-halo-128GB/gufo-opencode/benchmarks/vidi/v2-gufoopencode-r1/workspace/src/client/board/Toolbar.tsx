import type { CSSProperties, JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';

const containerStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 6,
  background: '#ffffff',
  border: '1px solid #d6dae1',
  borderRadius: 10,
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)'
};

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

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoState;
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export function Toolbar(props: ToolbarProps): JSX.Element {
  const stop = (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
  };

  return (
    <div data-testid="board-toolbar" style={containerStyle} onPointerDown={stop}>
      <button
        type="button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        style={buttonStyle}
        disabled={props.disabled === true}
        onClick={() => props.onCreateSticky()}
      >
        🗒
      </button>
      {props.undo !== undefined ? (
        <UndoButtons
          canUndo={props.undo.canUndo}
          canRedo={props.undo.canRedo}
          onUndo={props.undo.undo}
          onRedo={props.undo.redo}
        />
      ) : null}
    </div>
  );
}
