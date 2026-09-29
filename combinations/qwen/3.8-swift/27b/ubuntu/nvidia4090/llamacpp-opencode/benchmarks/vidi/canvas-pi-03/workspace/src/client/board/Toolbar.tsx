import type { CSSProperties, JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { ToolId } from '../tools/useActiveTool';
import type { ShapeKind } from 'src/shared/objects/shape';

export interface ToolbarProps {
  onCreateSticky: () => void;
  /** When true (board `load_failed`) the Sticky note, Shape and Connector buttons are disabled. */
  disabled?: boolean;
  /** Story 8: undo/redo state for the toolbar buttons (below the tools). */
  undo?: UndoState;
  /** Story 9/10: the active board tool (Select / Text / Shape / Connector buttons). */
  tool: ToolId;
  onToolChange: (t: ToolId) => void;
  /** Story 10: the Shape button's kind (Rectangle / Ellipse / Diamond). */
  shapeKind: ShapeKind;
  onShapeKindChange: (k: ShapeKind) => void;
}

/**
 * Fixed left-side toolbar with the Select / Text (story 9) / Shape and
 * Connector (story 10) tool buttons, the Sticky note button and, below the
 * tools, the Undo / Redo buttons (story 8). Stops pointer propagation so
 * clicks never reach the viewport (which would pan / clear the selection).
 *
 * Story 10: the Shape button carries a kind menu (Rectangle / Ellipse /
 * Diamond) shown while the Shape tool is active; picking a kind keeps the
 * tool active so the next drag draws that kind (prd "S … menu shows
 * Rectangle, Ellipse, Diamond").
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const shapeActive = props.tool === 'shape';
  return (
    <div
      data-testid="main-toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        backgroundColor: '#ffffff',
        border: '1px solid #d0d7de',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={props.tool === 'select'}
        data-testid="select-tool-button"
        onClick={() => props.onToolChange('select')}
        style={toolButtonStyle(props.tool === 'select')}
      >
        {/* Cursor glyph */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M4 2l12 8-6 1 3 6-2.5 1.2-3-6L4 16z"
            fill="none"
            stroke="#333"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text – T, then click the board"
        aria-pressed={props.tool === 'text'}
        data-testid="text-tool-button"
        disabled={props.disabled}
        onClick={() => props.onToolChange('text')}
        style={toolButtonStyle(props.tool === 'text')}
      >
        <span
          style={{
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            fontWeight: 700,
            fontSize: 18,
            color: '#333',
          }}
        >
          T
        </span>
      </button>
      {/* Story 10: Shape tool + kind menu. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape – S, then drag (Shift squares)"
          aria-pressed={shapeActive}
          data-testid="shape-tool-button"
          disabled={props.disabled}
          onClick={() => props.onToolChange('shape')}
          style={toolButtonStyle(shapeActive)}
        >
          {/* Rectangle glyph */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3" y="5" width="14" height="10" fill="none" stroke="#333" strokeWidth="1.5" />
          </svg>
        </button>
        {shapeActive && (
          <div
            data-testid="shape-kind-menu"
            aria-label="Shape kind"
            role="menu"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: 6,
              backgroundColor: '#ffffff',
              border: '1px solid #d0d7de',
              borderRadius: 6,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            <KindMenuItem
              kind="rect"
              label="Rectangle"
              active={props.shapeKind === 'rect'}
              onSelect={props.onShapeKindChange}
              glyph={<rect x="3" y="5" width="14" height="10" fill="none" stroke="#333" strokeWidth="1.5" />}
            />
            <KindMenuItem
              kind="ellipse"
              label="Ellipse"
              active={props.shapeKind === 'ellipse'}
              onSelect={props.onShapeKindChange}
              glyph={<ellipse cx="10" cy="10" rx="7" ry="5" fill="none" stroke="#333" strokeWidth="1.5" />}
            />
            <KindMenuItem
              kind="diamond"
              label="Diamond"
              active={props.shapeKind === 'diamond'}
              onSelect={props.onShapeKindChange}
              glyph={<polygon points="10,3 17,10 10,17 3,10" fill="none" stroke="#333" strokeWidth="1.5" />}
            />
          </div>
        )}
      </div>
      {/* Story 10: Connector tool. */}
      <button
        type="button"
        aria-label="Connector (L)"
        title="Connector – L, then drag between objects"
        aria-pressed={props.tool === 'connector'}
        data-testid="connector-tool-button"
        disabled={props.disabled}
        onClick={() => props.onToolChange('connector')}
        style={toolButtonStyle(props.tool === 'connector')}
      >
        {/* Arrow glyph */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <line x1="3" y1="15" x2="14" y2="5" stroke="#333" strokeWidth="1.5" />
          <polyline points="9,4 15,4 15,10" fill="none" stroke="#333" strokeWidth="1.5" />
        </svg>
      </button>
      {/* Story 11: Pen tool (pen.tool_ui). */}
      <button
        type="button"
        aria-label="Pen (P)"
        title="Pen – P, then draw"
        aria-pressed={props.tool === 'pen'}
        data-testid="pen-tool-button"
        disabled={props.disabled}
        onClick={() => props.onToolChange('pen')}
        style={toolButtonStyle(props.tool === 'pen')}
      >
        {/* Pencil glyph */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M4 16l1-4 9-9 3 3-9 9-4 1z"
            fill="none"
            stroke="#333"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-note-button"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FFF59D',
          border: '1px solid #c9b458',
          borderRadius: 6,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {/* Simple sticky-note glyph */}
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 3h16v10l-6 6H3z" fill="#fff8c4" stroke="#8a7a2a" strokeWidth="1.5" />
          <path d="M13 19v-6h6" fill="none" stroke="#8a7a2a" strokeWidth="1.5" />
        </svg>
      </button>
      {props.undo && <UndoButtons {...props.undo} />}
    </div>
  );
}

/** One row of the Shape kind menu (glyph + name). */
function KindMenuItem(props: {
  kind: ShapeKind;
  label: string;
  active: boolean;
  onSelect: (k: ShapeKind) => void;
  glyph: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-label={props.label}
      aria-pressed={props.active}
      data-testid={`shape-kind-${props.kind}`}
      onClick={() => props.onSelect(props.kind)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        backgroundColor: props.active ? '#D6E4FF' : '#FFFFFF',
        border: `1px solid ${props.active ? '#1A73E8' : '#d0d7de'}`,
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 12,
        color: '#333',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        {props.glyph}
      </svg>
      {props.label}
    </button>
  );
}

/** Shared tool-button look; the active tool is highlighted. */
function toolButtonStyle(active: boolean): CSSProperties {
  return {
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: active ? '#D6E4FF' : '#FFFFFF',
    border: `1px solid ${active ? '#1A73E8' : '#d0d7de'}`,
    borderRadius: 6,
    cursor: 'pointer',
    padding: 0,
  };
}
