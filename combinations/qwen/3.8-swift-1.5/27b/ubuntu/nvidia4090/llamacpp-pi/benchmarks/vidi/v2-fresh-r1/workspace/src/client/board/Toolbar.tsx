// Left-side vertical toolbar with the Sticky note button and Undo/Redo.

import { useCallback, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

interface ToolbarProps {
  onCreateSticky: () => void;
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Active tool (story 9+). */
  tool?: Tool;
  /** Switch the active tool (story 9+). */
  onToolChange?: (t: Tool) => void;
  /** Current shape kind (story 10). */
  shapeKind?: ShapeKind;
  /** Change the shape kind (story 10). */
  onShapeKindChange?: (k: ShapeKind) => void;
  /** Open the image file picker (story 12). */
  onOpenImagePicker?: () => void;
}

export function Toolbar({
  onCreateSticky,
  disabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  tool = 'select',
  onToolChange,
  shapeKind = 'rect',
  onShapeKindChange,
  onOpenImagePicker,
}: ToolbarProps) {
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const stopPointer = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
  }, []);
  const stopMouse = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      data-testid="toolbar"
      className="toolbar"
      style={{
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        zIndex: 100,
      }}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onPointerMove={stopPointer}
      onDoubleClick={stopMouse}
    >
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        data-testid="select-tool-btn"
        title="Select – V"
        onClick={() => onToolChange?.('select')}
        style={toolButtonStyle(tool === 'select')}
      >
        ➤
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        data-testid="text-tool-btn"
        title="Text – T"
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
        style={toolButtonStyle(tool === 'text')}
      >
        T
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        data-testid="sticky-note-btn"
        title="Sticky note – N, or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}
      >
        📝
      </button>
      {/* Shape tool button with kind menu (story 10) */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          data-testid="shape-tool-btn"
          title="Shape – S"
          onClick={() => {
            onToolChange?.('shape');
            setShowShapeMenu(!showShapeMenu);
          }}
          disabled={disabled}
          style={toolButtonStyle(tool === 'shape')}
        >
          ▭
        </button>
        {showShapeMenu && tool === 'shape' && (
          <div
            data-testid="shape-kind-menu"
            style={{
              position: 'absolute',
              left: '48px',
              top: '0',
              backgroundColor: 'white',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              zIndex: 200,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-label={`${k} shape`}
                data-testid={`shape-kind-${k}`}
                onClick={() => {
                  onShapeKindChange?.(k);
                  setShowShapeMenu(false);
                }}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: shapeKind === k ? '#E3F2FD' : 'transparent',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                  textTransform: 'capitalize',
                }}
              >
                {k === 'rect' ? 'Rectangle' : k === 'ellipse' ? 'Ellipse' : 'Diamond'}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Connector tool button (story 10) */}
      <button
        type="button"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        data-testid="connector-tool-btn"
        title="Connector – L"
        onClick={() => onToolChange?.('connector')}
        disabled={disabled}
        style={toolButtonStyle(tool === 'connector')}
      >
        →
      </button>
      {/* Pen tool button (story 11) */}
      <button
        type="button"
        aria-label="Pen (P)"
        aria-pressed={tool === 'pen'}
        data-testid="pen-tool-btn"
        title="Pen – P"
        onClick={() => onToolChange?.('pen')}
        disabled={disabled}
        style={toolButtonStyle(tool === 'pen')}
      >
        ✎
      </button>
      {/* Image tool button (story 12) */}
      <button
        type="button"
        aria-label="Image (I)"
        data-testid="image-tool-btn"
        title="Image – I, or drag files onto the board"
        onClick={onOpenImagePicker}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: '#E3F2FD',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}
      >
        🖼️
      </button>
      <UndoButtons
        canUndo={canUndo ?? false}
        canRedo={canRedo ?? false}
        undo={onUndo ?? (() => {})}
        redo={onRedo ?? (() => {})}
      />
    </div>
  );
}

/** Style for the tool toggle buttons (select/text). */
function toolButtonStyle(active: boolean): CSSProperties {
  return {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: active ? '#E3F2FD' : 'white',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    color: active ? '#1976D2' : '#555',
    boxShadow: active ? 'inset 0 0 0 2px #1976D2' : 'none',
  };
}
