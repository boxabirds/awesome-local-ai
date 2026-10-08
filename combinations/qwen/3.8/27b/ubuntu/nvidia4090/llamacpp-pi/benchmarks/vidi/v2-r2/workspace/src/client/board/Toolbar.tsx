import { type CSSProperties, type JSX } from 'react';
import { SHAPE_KINDS, STICKY_COLORS, type ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { UndoActions } from './useUndo';

export interface ToolbarProps {
  /** Create a sticky note at the viewport centre (N). */
  onCreateSticky(): void;
  /** Open the image file picker (story 12). */
  onImagePick(): void;
  /** The active tool (story 9/10) and its setter (Toolbar clicks). */
  tool: ToolId;
  onToolChange(t: ToolId): void;
  /** The kind the Shape tool draws with (story 10) and its setter. */
  shapeKind: ShapeKind;
  onShapeKindChange(k: ShapeKind): void;
  /**
   * When true (persist.client_status load_failed) the Sticky note button is
   * disabled, so a load-failed board can never create a note. The creation
   * tools are also unavailable (board.readonly): their buttons are disabled
   * and their shortcuts are ignored.
   */
  disabled?: boolean;
  /** Undo / Redo state and actions for this tab (story 8, undo.controls). */
  undo: UndoActions;
}

/** Shared 40x40 tool-button look. */
const TOOL_BUTTON_STYLE: CSSProperties = {
  width: 40,
  height: 40,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: '1px solid rgba(0,0,0,0.18)',
  borderRadius: 6,
  cursor: 'pointer',
};

/** Small 26x26 kind-button look (the shape kind row). */
const KIND_BUTTON_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: '1px solid rgba(0,0,0,0.18)',
  borderRadius: 5,
  cursor: 'pointer',
};

/** The little glyph for one shape kind. */
function KindGlyph({ kind }: { kind: ShapeKind }): JSX.Element {
  const common = {
    fill: 'none',
    stroke: '#3c3c34',
    strokeWidth: 2,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
      {kind === 'rect' && <rect x="4" y="7" width="16" height="10" {...common} />}
      {kind === 'ellipse' && <ellipse cx="12" cy="12" rx="8" ry="5.5" {...common} />}
      {kind === 'diamond' && <polygon points="12,4 20,12 12,20 4,12" {...common} />}
    </svg>
  );
}

/**
 * Fixed left toolbar: the Select, Text, Shape, Connector and Pen tools
 * (stories 9-11), the Sticky note button (story 2; shortcut N) and the
 * Undo / Redo buttons (story 8). While the Shape tool is active, a row of
 * kind buttons (rect / ellipse / diamond) sits under the tool buttons.
 *
 * It is rendered in screen space (outside the board's transformed world
 * layer) and stops pointer/double-click propagation so a press on it never
 * pans the board or creates a note.
 */
export function Toolbar({
  onCreateSticky,
  onImagePick,
  tool,
  onToolChange,
  shapeKind,
  onShapeKindChange,
  disabled = false,
  undo,
}: ToolbarProps): JSX.Element {
  return (
    <div
      data-testid="sticky-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: 'rgba(255,255,255,0.94)',
        border: '1px solid #d8d8d0',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 2000,
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={tool === 'select'}
        data-testid="select-button"
        onClick={() => onToolChange('select')}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: tool === 'select' ? '#e8f0fe' : '#ffffff',
          outline: tool === 'select' ? '1px solid #1a73e8' : 'none',
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3c3c34"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 3l7 17 2.5-7.5L21 10z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title={disabled ? 'Board unavailable' : 'Text – T, then click the board'}
        aria-pressed={tool === 'text'}
        disabled={disabled}
        data-testid="text-button"
        onClick={() => onToolChange('text')}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: tool === 'text' ? '#e8f0fe' : '#ffffff',
          color: '#3c3c34',
          fontSize: 18,
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        <span aria-hidden="true">T</span>
      </button>
      <button
        type="button"
        aria-label="Shape (S)"
        title={disabled ? 'Board unavailable' : 'Shape – S, then drag or click the board'}
        aria-pressed={tool === 'shape'}
        disabled={disabled}
        data-testid="shape-button"
        onClick={() => onToolChange('shape')}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: tool === 'shape' ? '#e8f0fe' : '#ffffff',
          outline: tool === 'shape' ? '1px solid #1a73e8' : 'none',
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3c3c34"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          <rect x="4" y="4" width="16" height="16" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Connector (L)"
        title={disabled ? 'Board unavailable' : 'Connector – L, then drag between two objects'}
        aria-pressed={tool === 'connector'}
        disabled={disabled}
        data-testid="connector-button"
        onClick={() => onToolChange('connector')}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: tool === 'connector' ? '#e8f0fe' : '#ffffff',
          outline: tool === 'connector' ? '1px solid #1a73e8' : 'none',
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3c3c34"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h12" />
          <path d="M13 7l5 5-5 5" />
          <circle cx="4.5" cy="12" r="1.5" fill="#3c3c34" stroke="none" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Pen (P)"
        title={disabled ? 'Board unavailable' : 'Pen – P, then drag on the board'}
        aria-pressed={tool === 'pen'}
        disabled={disabled}
        data-testid="pen-button"
        onClick={() => onToolChange('pen')}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: tool === 'pen' ? '#e8f0fe' : '#ffffff',
          outline: tool === 'pen' ? '1px solid #1a73e8' : 'none',
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3c3c34"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      </button>
      {tool === 'shape' && (
        <div
          data-testid="shape-kind-row"
          role="radiogroup"
          aria-label="Shape kind"
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          {SHAPE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={shapeKind === kind}
              aria-label={
                kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Diamond'
              }
              title={kind}
              data-testid={`shape-kind-${kind}`}
              onClick={() => onShapeKindChange(kind)}
              style={{
                ...KIND_BUTTON_STYLE,
                background: shapeKind === kind ? '#e8f0fe' : '#ffffff',
                outline: shapeKind === kind ? '1px solid #1a73e8' : 'none',
              }}
            >
              <KindGlyph kind={kind} />
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label="Sticky note (N)"
        title={disabled ? 'Board unavailable' : 'Sticky note – N, or double-click the board'}
        disabled={disabled}
        data-testid="sticky-note-button"
        onClick={onCreateSticky}
        style={{
          ...TOOL_BUTTON_STYLE,
          background: STICKY_COLORS.yellow,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            display: 'block',
            background: 'rgba(255,255,255,0.55)',
            border: '1.5px solid rgba(0,0,0,0.25)',
            borderRadius: 2,
          }}
        />
      </button>
      <button
        type="button"
        aria-label="Image (I)"
        title={disabled ? 'Board unavailable' : 'Image – I, opens file picker'}
        disabled={disabled}
        data-testid="image-button"
        onClick={onImagePick}
        style={{
          ...TOOL_BUTTON_STYLE,
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#3c3c34"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
