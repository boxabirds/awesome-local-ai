import type { CSSProperties, JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { Tool } from './useTool';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

const containerStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  // Above tool overlays (zIndex 45) so the toolbar stays clickable while a
  // creation tool is armed (story 11: Pen stays active after each stroke).
  zIndex: 50,
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
  // Story 10: the pending shape kind and its menu (Rectangle/Ellipse/Diamond).
  shapeKind?: ShapeKind;
  onShapeKindChange?(kind: ShapeKind): void;
}

const KIND_LABEL: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond'
};

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
          <button
            type="button"
            aria-label="Shape (S)"
            title="Shape – or press S"
            aria-pressed={props.tool === 'shape'}
            style={buttonStyle}
            disabled={props.disabled === true}
            onClick={() => props.onToolChange?.('shape')}
          >
            ▢
          </button>
          <button
            type="button"
            aria-label="Connector (L)"
            title="Connector – or press L"
            aria-pressed={props.tool === 'connector'}
            style={buttonStyle}
            disabled={props.disabled === true}
            onClick={() => props.onToolChange?.('connector')}
          >
            ↗
          </button>
          <button
            type="button"
            aria-label="Pen (P)"
            title="Pen – or press P"
            aria-pressed={props.tool === 'pen'}
            style={buttonStyle}
            disabled={props.disabled === true}
            onClick={() => props.onToolChange?.('pen')}
          >
            ✎
          </button>
          {props.shapeKind !== undefined ? (
            <div data-testid="shape-kind-menu" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {SHAPE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-label={KIND_LABEL[kind]}
                  title={`${KIND_LABEL[kind]} shape`}
                  aria-pressed={props.shapeKind === kind}
                  data-testid={`shape-kind-${kind}`}
                  style={{
                    height: 14,
                    padding: '0 4px',
                    border: props.shapeKind === kind ? '1px solid #1E88E5' : '1px solid #d6dae1',
                    background: props.shapeKind === kind ? '#E3F2FD' : '#f3f4f6',
                    borderRadius: 4,
                    fontSize: 10,
                    cursor: 'pointer'
                  }}
                  disabled={props.disabled === true}
                  onClick={() => {
                    props.onShapeKindChange?.(kind);
                    props.onToolChange?.('shape');
                  }}
                >
                  {KIND_LABEL[kind]}
                </button>
              ))}
            </div>
          ) : null}
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
