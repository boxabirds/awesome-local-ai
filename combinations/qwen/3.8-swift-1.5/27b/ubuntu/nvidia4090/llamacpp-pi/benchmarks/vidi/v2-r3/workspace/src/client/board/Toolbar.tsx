import { STICKY_COLORS, SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { UndoControls } from './useUndo';
import type { Tool } from './useTool';
import type { ToolId } from '../tools/useActiveTool';

export interface ToolbarProps {
  /** Story 9: the active tool (Select / Text) for the `aria-pressed` state. */
  tool?: Tool;
  setTool?: (t: Tool) => void;
  /** Story 10: extended tool state. */
  activeTool?: ToolId;
  setActiveTool?: (t: ToolId) => void;
  shapeKind?: ShapeKind;
  setShapeKind?: (k: ShapeKind) => void;
  onCreateSticky: () => void;
  disabled?: boolean;
  /** Per-client undo/redo controls (story 8); rendered below the tools. */
  undo?: UndoControls;
  /** Story 12: open the image file picker. */
  onImagePick?: () => void;
}

const toolBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #cfcfcf',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
  padding: 0,
  fontSize: 12,
  fontWeight: 600,
  color: '#333',
};

const pressedBtn: React.CSSProperties = {
  background: '#e8f0fe',
  borderColor: '#4285f4',
};

/**
 * Fixed left-side toolbar. Story 9: the Select (V) and Text (T) tool buttons
 * (with `aria-pressed`) sit above the story-2 Sticky note button, whose label
 * now reads "Sticky note (N)". Below the tools: the Undo/Redo buttons
 * (story 8). Pointer events stop propagation so clicks never reach the
 * viewport (which would pan/clear).
 */
export function Toolbar({
  tool = 'select',
  setTool,
  activeTool,
  setActiveTool,
  shapeKind = 'rect',
  setShapeKind,
  onCreateSticky,
  disabled,
  undo,
  onImagePick,
}: ToolbarProps): React.ReactElement {
  // Use the extended tool state if available, otherwise fall back to the old one
  const currentTool = activeTool ?? tool;
  const handleSetTool = (t: ToolId) => {
    if (setActiveTool) setActiveTool(t);
    else if (setTool && (t === 'select' || t === 'text')) setTool(t);
  };

  const selectPressed = currentTool === 'select';
  const textPressed = currentTool === 'text';
  const shapePressed = currentTool === 'shape';
  const connectorPressed = currentTool === 'connector';
  const penPressed = currentTool === 'pen';

  const shapeKindLabels: Record<ShapeKind, string> = {
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    diamond: 'Diamond',
  };

  return (
    <div
      data-testid="toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid #d0d0d0',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        zIndex: 20,
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={selectPressed}
        title="Select (V)"
        onClick={() => handleSetTool('select')}
        style={{ ...toolBtn, ...(selectPressed ? pressedBtn : {}) }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>
          ✥
        </span>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={textPressed}
        title="Text (T) – write free text anywhere"
        onClick={() => handleSetTool('text')}
        disabled={disabled}
        style={{
          ...toolBtn,
          ...(textPressed ? pressedBtn : {}),
          ...(disabled ? { background: '#f5f5f5', cursor: 'not-allowed', opacity: 0.5 } : {}),
        }}
      >
        <span aria-hidden>T</span>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          ...toolBtn,
          background: disabled ? '#f5f5f5' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            background: STICKY_COLORS.yellow,
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 3,
            display: 'block',
          }}
        />
      </button>
      {/* Story 10: Shape button with kind menu */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Shape (S)"
          aria-pressed={shapePressed}
          title={`Shape (S) – ${shapeKindLabels[shapeKind]}`}
          onClick={() => handleSetTool('shape')}
          disabled={disabled}
          style={{
            ...toolBtn,
            ...(shapePressed ? pressedBtn : {}),
            ...(disabled ? { background: '#f5f5f5', cursor: 'not-allowed', opacity: 0.5 } : {}),
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>⬜</span>
        </button>
        {shapePressed && (
          <div
            data-testid="shape-kind-menu"
            role="menu"
            aria-label="Shape kind"
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              marginLeft: 8,
              background: '#fff',
              border: '1px solid #d0d0d0',
              borderRadius: 6,
              padding: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              zIndex: 25,
            }}
          >
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                aria-label={shapeKindLabels[k]}
                aria-pressed={shapeKind === k}
                onClick={() => setShapeKind?.(k)}
                style={{
                  border: 'none',
                  background: shapeKind === k ? '#e8f0fe' : 'transparent',
                  borderRadius: 4,
                  padding: '4px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  textAlign: 'left',
                }}
              >
                {shapeKindLabels[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Story 10: Connector button */}
      <button
        type="button"
        aria-label="Connector (L)"
        aria-pressed={connectorPressed}
        title="Connector (L) – draw arrows between objects"
        onClick={() => handleSetTool('connector')}
        disabled={disabled}
        style={{
          ...toolBtn,
          ...(connectorPressed ? pressedBtn : {}),
          ...(disabled ? { background: '#f5f5f5', cursor: 'not-allowed', opacity: 0.5 } : {}),
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>→</span>
      </button>
      {/* Story 11: Pen button */}
      <button
        type="button"
        aria-label="Pen (P)"
        aria-pressed={penPressed}
        title="Pen (P) – draw freehand"
        onClick={() => handleSetTool('pen')}
        disabled={disabled}
        style={{
          ...toolBtn,
          ...(penPressed ? pressedBtn : {}),
          ...(disabled ? { background: '#f5f5f5', cursor: 'not-allowed', opacity: 0.5 } : {}),
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>✎</span>
      </button>
      {/* Story 12: Image button */}
      <button
        type="button"
        aria-label="Image (I)"
        title="Image (I) – add an image"
        onClick={() => {
          if (onImagePick) onImagePick();
          else handleSetTool('image');
        }}
        disabled={disabled}
        style={{
          ...toolBtn,
          ...(disabled ? { background: '#f5f5f5', cursor: 'not-allowed', opacity: 0.5 } : {}),
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>🖼</span>
      </button>
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
