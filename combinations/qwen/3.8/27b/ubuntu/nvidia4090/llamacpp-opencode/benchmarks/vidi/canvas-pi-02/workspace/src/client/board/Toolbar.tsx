import { useState } from 'react';
import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { Tool } from './useTool';
import type { ShapeKind } from '../../shared/config';
import { SHAPE_KINDS } from '../../shared/config';

export interface ToolbarProps {
  /** Create a sticky note centred in the visible board area, in edit mode. */
  onCreateSticky(): void;
  /** persist.client_status: disabled while the board is locked. */
  disabled?: boolean;
  /** Undo / redo state (story 8); renders the UndoButtons below the tools. */
  undo?: UndoState;
  /** Current tool (story 9/10). */
  tool?: Tool;
  /** Change the tool (story 9/10). */
  onToolChange?: (tool: Tool) => void;
  /** The shape kind selected in the Shape menu (story 10). */
  shapeKind?: ShapeKind;
  /** Change the shape kind (story 10). */
  onShapeKindChange?: (k: ShapeKind) => void;
}

const STOP = (e: { stopPropagation(): void }): void => {
  e.stopPropagation();
};

/**
 * Fixed left-side board toolbar with the Sticky note button and (story 9)
 * the Text button. The container stops pointer propagation so a click here
 * never reaches the viewport.
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
  const tool = props.tool ?? 'select';
  return (
    <div
      className="vidi6-toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={STOP}
      onPointerUp={STOP}
      onPointerCancel={STOP}
      onDoubleClick={STOP}
      onClick={STOP}
    >
      <button
        type="button"
        className={`vidi6-toolbar__button${tool === 'select' ? ' vidi6-toolbar__button--active' : ''}`}
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – or press V"
        disabled={props.disabled ?? false}
        onClick={() => props.onToolChange?.('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M4 4l12 8-5 1-2 5-5-14z"
            fill="#E8ECF1"
            stroke="#5A6B7F"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="vidi6-toolbar__button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        disabled={props.disabled ?? false}
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3.5 3.5h13v9l-4 4h-9v-13Z"
            fill="#FFF59D"
            stroke="#B9A83C"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M12.5 16.5v-4h4" fill="#FFF59D" stroke="#B9A83C" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className={`vidi6-toolbar__button${tool === 'text' ? ' vidi6-toolbar__button--active' : ''}`}
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – or press T, then click the board"
        disabled={props.disabled ?? false}
        onClick={() => props.onToolChange?.('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <text
            x="10"
            y="15"
            textAnchor="middle"
            fontSize="16"
            fontWeight="600"
            fill="#2C3E50"
            fontFamily="Inter, sans-serif"
          >
            T
          </text>
        </svg>
      </button>
      {/* Shape tool (story 10) */}
      <ShapeToolButton
        tool={tool}
        shapeKind={props.shapeKind ?? 'rect'}
        onToolChange={props.onToolChange}
        onShapeKindChange={props.onShapeKindChange}
        disabled={props.disabled ?? false}
      />
      {/* Pen tool (story 11) */}
      <button
        type="button"
        className={`vidi6-toolbar__button${tool === 'pen' ? ' vidi6-toolbar__button--active' : ''}`}
        aria-label="Pen (P)"
        aria-pressed={tool === 'pen'}
        title="Pen – or press P, then drag on the board"
        disabled={props.disabled ?? false}
        onClick={() => props.onToolChange?.('pen')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3.5 16.5l1-4L13.5 3.5c.8-.8 2-.8 2.8 0 .8.8.8 2 0 2.8L7.5 15.5l-4 1Z"
            fill="#E8ECF1"
            stroke="#5A6B7F"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M12.5 4.5l3 3" stroke="#5A6B7F" strokeWidth="1.2" />
        </svg>
      </button>
      {/* Connector tool (story 10) */}
      <button
        type="button"
        className={`vidi6-toolbar__button${tool === 'connector' ? ' vidi6-toolbar__button--active' : ''}`}
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector – or press L, then drag between objects"
        disabled={props.disabled ?? false}
        onClick={() => props.onToolChange?.('connector')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <line x1="4" y1="10" x2="14" y2="10" stroke="#5A6B7F" strokeWidth="1.5" />
          <polygon points="14,7 17,10 14,13" fill="#5A6B7F" />
          <circle cx="4" cy="10" r="2" fill="#E8ECF1" stroke="#5A6B7F" strokeWidth="1" />
        </svg>
      </button>
      {props.undo !== undefined && <UndoButtons {...props.undo} />}
    </div>
  );
}

/**
 * Shape tool button with a dropdown menu for selecting the shape kind
 * (story 10, shape.tool). Clicking the button opens the menu; clicking a
 * menu item activates the Shape tool with that kind.
 */
function ShapeToolButton({
  tool,
  shapeKind,
  onToolChange,
  onShapeKindChange,
  disabled,
}: {
  tool: Tool;
  shapeKind: ShapeKind;
  onToolChange?: (tool: Tool) => void;
  onShapeKindChange?: (k: ShapeKind) => void;
  disabled?: boolean;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  const selectKind = (k: ShapeKind) => {
    setMenuOpen(false);
    onShapeKindChange?.(k);
    onToolChange?.('shape');
  };

  return (
    <div style={{ position: 'relative' }} onClick={STOP}>
      <button
        type="button"
        className={`vidi6-toolbar__button${tool === 'shape' ? ' vidi6-toolbar__button--active' : ''}`}
        aria-label={`Shape: ${shapeKind} (S)`}
        aria-pressed={tool === 'shape'}
        title="Shape – or press S, then click or drag the board"
        disabled={disabled}
        onClick={() => {
          setMenuOpen(!menuOpen);
          if (tool !== 'shape') {
            onToolChange?.('shape');
          }
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          {shapeKind === 'rect' && (
            <rect x="3" y="5" width="14" height="10" fill="#E8ECF1" stroke="#5A6B7F" strokeWidth="1.2" />
          )}
          {shapeKind === 'ellipse' && (
            <ellipse cx="10" cy="10" rx="7" ry="5" fill="#E8ECF1" stroke="#5A6B7F" strokeWidth="1.2" />
          )}
          {shapeKind === 'diamond' && (
            <polygon points="10,3 17,10 10,17 3,10" fill="#E8ECF1" stroke="#5A6B7F" strokeWidth="1.2" />
          )}
        </svg>
      </button>
      {menuOpen && (
        <div
          data-testid="shape-menu"
          className="vidi6-shape-menu"
          style={{
            position: 'absolute',
            left: '100%',
            top: 0,
            marginLeft: 4,
            background: 'white',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            padding: '4px 0',
            zIndex: 1001,
            minWidth: 100,
          }}
          onPointerDown={STOP}
          onClick={STOP}
        >
          {SHAPE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`shape-menu-${k}`}
              onClick={() => selectKind(k)}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: shapeKind === k ? '#E8F0FE' : 'none',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
                color: '#37474F',
              }}
            >
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
