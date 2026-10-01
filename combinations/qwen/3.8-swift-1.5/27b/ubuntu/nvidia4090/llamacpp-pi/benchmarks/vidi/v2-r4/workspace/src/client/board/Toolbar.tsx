import { useState, type JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';
import type { ShapeKind } from '../../shared/objects/shape';
import { SHAPE_KINDS } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  /** Per-user undo controls (story 8). Omit to hide the buttons. */
  undo?: UseUndoResult;
  /** Active tool (story 9) and its setter for the tool buttons. */
  tool?: Tool;
  setTool?(t: Tool): void;
  /** Shape kind (story 10) */
  shapeKind?: ShapeKind;
  setShapeKind?(k: ShapeKind): void;
}

const toolButtonStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  width: 40,
  height: 40,
  border: '1px solid #ccc',
  borderRadius: 8,
  backgroundColor: disabled ? '#E5E7EB' : active ? '#BBDEFB' : '#FFFFFF',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  opacity: disabled ? 0.5 : 1,
});

const shapeKindLabels: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export function Toolbar(props: ToolbarProps): JSX.Element {
  const {
    onCreateSticky, disabled = false, undo,
    tool = 'select', setTool,
    shapeKind = 'rect', setShapeKind,
  } = props;
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  return (
    <div
      data-testid="toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {setTool && (
        <>
          <button
            aria-label="Select (V)"
            title="Select – V"
            aria-pressed={tool === 'select'}
            onClick={disabled ? undefined : () => setTool('select')}
            disabled={disabled}
            style={toolButtonStyle(tool === 'select', disabled)}
          >
            ⬚
          </button>
          <button
            aria-label="Text (T)"
            title="Text – T, then click the board"
            aria-pressed={tool === 'text'}
            onClick={disabled ? undefined : () => setTool('text')}
            disabled={disabled}
            style={toolButtonStyle(tool === 'text', disabled)}
          >
            T
          </button>

          {/* Shape button with kind menu (story 10) */}
          <div style={{ position: 'relative' }}>
            <button
              aria-label="Shape (S)"
              title="Shape – S"
              aria-pressed={tool === 'shape'}
              onClick={disabled ? undefined : () => {
                setTool('shape');
                setShapeMenuOpen(!shapeMenuOpen);
              }}
              disabled={disabled}
              style={toolButtonStyle(tool === 'shape', disabled)}
            >
              □
            </button>
            {shapeMenuOpen && tool === 'shape' && (
              <div
                data-testid="shape-kind-menu"
                style={{
                  position: 'absolute',
                  left: 44,
                  top: 0,
                  backgroundColor: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: 8,
                  padding: 4,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {SHAPE_KINDS.map((k) => (
                  <button
                    key={k}
                    aria-label={shapeKindLabels[k]}
                    onClick={() => {
                      setShapeKind?.(k);
                      setShapeMenuOpen(false);
                    }}
                    style={{
                      padding: '4px 12px',
                      border: 'none',
                      borderRadius: 4,
                      backgroundColor: shapeKind === k ? '#BBDEFB' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 14,
                    }}
                  >
                    {shapeKindLabels[k]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            aria-label="Connector (L)"
            title="Connector – L"
            aria-pressed={tool === 'connector'}
            onClick={disabled ? undefined : () => setTool('connector')}
            disabled={disabled}
            style={toolButtonStyle(tool === 'connector', disabled)}
          >
            →
          </button>

          <button
            aria-label="Pen (P)"
            title="Pen – P"
            aria-pressed={tool === 'pen'}
            onClick={disabled ? undefined : () => setTool('pen')}
            disabled={disabled}
            style={toolButtonStyle(tool === 'pen', disabled)}
          >
            ✎
          </button>
        </>
      )}
      <button
        aria-label="Sticky note (N)"
        title="Sticky note – N, or double-click the board"
        onClick={disabled ? undefined : onCreateSticky}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #ccc',
          borderRadius: 8,
          backgroundColor: disabled ? '#E5E7EB' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        📝
      </button>
      {undo && <UndoButtons undo={undo} disabled={disabled} />}
    </div>
  );
}
