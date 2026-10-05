import { useState, type ReactNode } from 'react';
import type { Tool } from './useTool';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';

/**
 * Top-left toolbar (story 7: undo/redo; story 9: tool row; story 10: shape + connector).
 */
export interface ToolbarProps {
  tool: Tool;
  onToolChange(t: Tool): void;
  /** Viewers (role guest) cannot arm editing tools. */
  canEdit: boolean;
  /** One-click sticky note at the view centre (story 1). */
  onCreateSticky(): void;
  undoButtons: ReactNode;
  /** Story 10: current shape kind. */
  shapeKind?: ShapeKind;
  /** Story 10: change the shape kind. */
  onShapeKindChange?(k: ShapeKind): void;
}

const buttonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 16,
  padding: '4px 6px',
  borderRadius: 4,
};

const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { tool, onToolChange, canEdit, onCreateSticky, undoButtons, shapeKind = 'rect', onShapeKindChange } = props;
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

  return (
    <div
      data-testid="toolbar"
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      {/* Tool row */}
      <button
        type="button"
        data-testid="select-tool-button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        style={{ ...buttonStyle, opacity: 0.9 }}
        onClick={() => onToolChange('select')}
      >
        ⬚
      </button>
      <button
        type="button"
        data-testid="text-tool-button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        disabled={!canEdit}
        style={{
          ...buttonStyle,
          fontFamily: 'Georgia, serif',
          fontWeight: 700,
          opacity: canEdit ? 0.9 : 0.4,
        }}
        onClick={() => onToolChange('text')}
      >
        T
      </button>
      <button
        type="button"
        data-testid="sticky-note-button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        style={{ ...buttonStyle, opacity: 0.9 }}
        onClick={onCreateSticky}
      >
        🗒️
      </button>
      <span style={{ width: 1, height: 20, background: '#ddd', margin: '0 4px' }} />

      {/* Story 10: Shape button with kind menu */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          data-testid="shape-tool-button"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          title={`Shape (S) – ${SHAPE_KIND_LABELS[shapeKind]}`}
          disabled={!canEdit}
          style={{
            ...buttonStyle,
            opacity: canEdit ? 0.9 : 0.4,
            border: tool === 'shape' ? '2px solid #1A73E8' : '2px solid transparent',
          }}
          onClick={() => {
            if (tool === 'shape') {
              setShapeMenuOpen(!shapeMenuOpen);
            } else {
              onToolChange('shape');
            }
          }}
        >
          □
        </button>
        {shapeMenuOpen && (
          <div
            data-testid="shape-kind-menu"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: 4,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              padding: 4,
              zIndex: 20,
            }}
          >
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                data-testid={`shape-kind-${k}`}
                aria-label={SHAPE_KIND_LABELS[k]}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '4px 12px',
                  border: 'none',
                  background: shapeKind === k ? '#BBDEFB' : 'transparent',
                  cursor: 'pointer',
                  borderRadius: 3,
                  fontSize: 14,
                }}
                onClick={() => {
                  onShapeKindChange?.(k);
                  setShapeMenuOpen(false);
                }}
              >
                {SHAPE_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Story 10: Connector button */}
      <button
        type="button"
        data-testid="connector-tool-button"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector (L)"
        disabled={!canEdit}
        style={{
          ...buttonStyle,
          opacity: canEdit ? 0.9 : 0.4,
        }}
        onClick={() => onToolChange('connector')}
      >
        →
      </button>

      <span style={{ width: 1, height: 20, background: '#ddd', margin: '0 4px' }} />
      {undoButtons}
    </div>
  );
}
