import type { ReactElement } from 'react';
import { UndoButtons } from './UndoButtons';
import type { ToolId } from '../tools/useActiveTool';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import { shapeKindName } from '../objects/ShapeToolbar';
import { TEXT_SIZES } from '../../shared/config';

function ToolButton(props: {
  label: string;
  glyph: string;
  pressed: boolean;
  disabled?: boolean;
  onClick(): void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        width: 40,
        height: 40,
        fontSize: 18,
        borderRadius: 8,
        border: '1px solid #d5d9e0',
        background: props.pressed ? '#1a73e8' : props.disabled ? '#e8eaee' : '#fff',
        color: props.pressed ? '#fff' : '#23272e',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
      }}
    >
      {props.glyph}
    </button>
  );
}

/**
 * Left toolbar: the Select / Shape / Text / Connector / Pen tool buttons,
 * the Sticky note button (shortcut N, or double-click the board) and the
 * Undo/Redo buttons (story 8). `disabled` (the board failed to load)
 * disables the editing buttons; the double-click path is gated in App.
 *
 * Story 10: selecting the Shape tool opens the kind menu (Rectangle /
 * Ellipse / Diamond) next to the button; the current kind is the menu's
 * aria-pressed entry and the next drawn shape's kind.
 */
export function Toolbar(props: {
  tool: ToolId;
  shapeKind: ShapeKind;
  onSelectTool(t: ToolId): void;
  onShapeKind(k: ShapeKind): void;
  onCreateSticky(): void;
  /** Story 12: opens the system file picker for adding images (I key too). */
  onImagePicker(): void;
  disabled?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}): ReactElement {
  return (
    <div
      className="toolbar"
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 20,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ToolButton
        label="Select (V)"
        glyph="⬚"
        pressed={props.tool === 'select'}
        onClick={() => props.onSelectTool('select')}
      />
      <div style={{ position: 'relative' }}>
        <ToolButton
          label="Shape (S)"
          glyph="▭"
          pressed={props.tool === 'shape'}
          disabled={props.disabled}
          onClick={() => props.onSelectTool('shape')}
        />
        {props.tool === 'shape' && (
          <div
            data-shape-kind-menu="true"
            style={{
              position: 'absolute',
              left: 'calc(100% + 8px)',
              top: 0,
              background: '#fff',
              border: '1px solid #d5d9e0',
              borderRadius: 8,
              padding: 4,
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              zIndex: 20,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-label={shapeKindName(k)}
                aria-pressed={props.shapeKind === k}
                onClick={() => props.onShapeKind(k)}
                style={{
                  border: 'none',
                  background: props.shapeKind === k ? '#e8f0fe' : 'transparent',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {shapeKindName(k)}
              </button>
            ))}
          </div>
        )}
      </div>
      <ToolButton
        label="Text (T)"
        glyph="T"
        pressed={props.tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onSelectTool('text')}
      />
      <ToolButton
        label="Connector (L)"
        glyph="→"
        pressed={props.tool === 'connector'}
        disabled={props.disabled}
        onClick={() => props.onSelectTool('connector')}
      />
      <ToolButton
        label="Pen (P)"
        glyph="✎"
        pressed={props.tool === 'pen'}
        disabled={props.disabled}
        onClick={() => props.onSelectTool('pen')}
      />
      <div style={{ height: 1, background: '#e4e7ec', margin: '2px 0' }} />
      <button
        type="button"
        aria-label="Image (I)"
        title="Add images (I) — or drag & drop or paste"
        disabled={props.disabled}
        onClick={props.onImagePicker}
        style={{
          width: 40,
          height: 40,
          fontSize: 18,
          borderRadius: 8,
          border: '1px solid #d5d9e0',
          background: props.disabled ? '#e8eaee' : '#E8F0FE',
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          opacity: props.disabled ? 0.6 : 1,
        }}
      >
        ▣
      </button>
      <button
        type="button"
        aria-label="Sticky note"
        title={`Sticky note (N) – or double-click the board (default size ${TEXT_SIZES.M}px)`}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
        style={{
          width: 40,
          height: 40,
          fontSize: 18,
          borderRadius: 8,
          border: '1px solid #d5d9e0',
          background: props.disabled ? '#e8eaee' : '#FFF59D',
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          opacity: props.disabled ? 0.6 : 1,
        }}
      >
        +
      </button>
      <div style={{ height: 1, background: '#e4e7ec', margin: '2px 0' }} />
      <UndoButtons
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        disabled={props.disabled}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
      />
    </div>
  );
}
