import { useState, useRef, useEffect } from 'react';
import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoBinding } from './useUndo';
import type { ToolId } from '../tools/useActiveTool';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

interface ToolbarProps {
  onCreateSticky: () => void;
  /** When true the create button is disabled (board failed to load). */
  disabled?: boolean;
  /** Undo/redo binding (story 8). */
  undo?: UndoBinding;
  /** Active tool (story 9/10). */
  tool?: ToolId;
  /** Change the active tool. */
  onToolChange?: (t: ToolId) => void;
  /** Current shape kind (story 10). */
  shapeKind?: ShapeKind;
  /** Change the shape kind (story 10). */
  onShapeKindChange?: (k: ShapeKind) => void;
}

/**
 * Fixed left-side toolbar with tool buttons, a Sticky note button and undo/redo buttons.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const { onCreateSticky, disabled = false, undo, tool = 'select', onToolChange, shapeKind = 'rect', onShapeKindChange } = props;
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeBtnRef = useRef<HTMLButtonElement>(null);

  // Close shape menu on outside click
  useEffect(() => {
    if (!shapeMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (shapeBtnRef.current && !shapeBtnRef.current.contains(e.target as Node)) {
        setShapeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [shapeMenuOpen]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  const btnStyle = (active: boolean, isDisabled = false): React.CSSProperties => ({
    width: '40px',
    height: '40px',
    borderRadius: '6px',
    border: active ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.2)',
    background: active ? '#E8F0FE' : 'white',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    opacity: isDisabled ? 0.5 : 1,
  });

  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board toolbar"
      onPointerDown={handlePointerDown}
      style={{
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
      }}
    >
      {/* Select tool */}
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – V"
        data-testid="tool-select-btn"
        onClick={() => onToolChange?.('select')}
        style={btnStyle(tool === 'select')}
      >
        ↖
      </button>

      {/* Text tool */}
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – T"
        data-testid="tool-text-btn"
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
        style={btnStyle(tool === 'text', disabled)}
      >
        T
      </button>

      {/* Shape tool with kind menu */}
      <div style={{ position: 'relative' }}>
        <button
          ref={shapeBtnRef}
          type="button"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          title="Shape – S"
          data-testid="tool-shape-btn"
          onClick={() => {
            onToolChange?.('shape');
            setShapeMenuOpen((o) => !o);
          }}
          disabled={disabled}
          style={btnStyle(tool === 'shape', disabled)}
        >
          □
        </button>
        {shapeMenuOpen && (
          <div
            data-testid="shape-kind-menu"
            role="menu"
            aria-label="Shape kind"
            style={{
              position: 'absolute',
              left: '48px',
              top: '0',
              background: 'white',
              borderRadius: '6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: '4px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              zIndex: 101,
            }}
          >
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                aria-label={`${k[0].toUpperCase() + k.slice(1)} shape`}
                data-testid={`shape-kind-${k}`}
                onClick={() => {
                  onShapeKindChange?.(k);
                  setShapeMenuOpen(false);
                }}
                style={{
                  padding: '6px 12px',
                  border: shapeKind === k ? '2px solid #1a73e8' : '1px solid transparent',
                  borderRadius: '4px',
                  background: shapeKind === k ? '#E8F0FE' : 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                  textTransform: 'capitalize',
                }}
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Connector tool */}
      <button
        type="button"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector – L"
        data-testid="tool-connector-btn"
        onClick={() => onToolChange?.('connector')}
        disabled={disabled}
        style={btnStyle(tool === 'connector', disabled)}
      >
        →
      </button>

      {/* Sticky note button */}
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note – N"
        data-testid="create-sticky-btn"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '6px',
          border: '1px solid rgba(0,0,0,0.2)',
          background: disabled ? '#E8EAED' : '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        +
      </button>

      {undo && (
        <div style={{ height: '1px', background: 'rgba(0,0,0,0.15)', margin: '0 2px' }} />
      )}
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
