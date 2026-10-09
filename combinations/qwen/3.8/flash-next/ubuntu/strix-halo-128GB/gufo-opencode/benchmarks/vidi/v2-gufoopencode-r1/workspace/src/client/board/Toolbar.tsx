import type { CSSProperties, JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { Tool } from './useTool';

const containerStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  display: 'flex',
  flexDirection: 'row',
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
  // Story 9: when provided, the tool switcher is rendered above the actions.
  tool?: Tool;
  onToolChange?(tool: Tool): void;
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

export function Toolbar(props: ToolbarProps): JSX.Element {
  const stop = (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
  };
  const showTools = props.tool !== undefined && props.onToolChange !== undefined;

  return (
    <div data-testid="board-toolbar" style={containerStyle} onPointerDown={stop}>
      {showTools ? (
        <>
          <button
            type="button"
            aria-label="Select (V)"
            title="Select – or press V"
            aria-pressed={props.tool === 'select'}
            style={buttonStyle}
            onClick={() => props.onToolChange?.('select')}
          >
            ↖
          </button>
          <button
            type="button"
            aria-label="Text (T)"
            title="Text – or press T"
            aria-pressed={props.tool === 'text'}
            style={buttonStyle}
            disabled={props.disabled === true}
            onClick={() => props.onToolChange?.('text')}
          >
            T
          </button>
        </>
      ) : null}
      <button
        type="button"
        aria-label="Sticky note (N)"
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
