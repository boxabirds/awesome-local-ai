// Left board toolbar (stories 1, 9, 10): tool buttons (Select / Text /
// Shape / Connector) + the sticky note button and undo/redo. The sticky
// note button is NOT a tool — it creates one sticky and keeps the current
// tool. Creation tools are disabled on a non-editable board
// (tools.not_editable). The Shape button opens a small kind menu
// (Rectangle / Ellipse / Diamond) while the Shape tool is active.

import type { ReactElement } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import { SHAPE_KIND_LABELS } from '../objects/ShapeObject';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';

export interface ToolbarProps {
  /** The active board tool (story 10). */
  tool: ToolId;
  /** Switches the active tool. */
  onTool(tool: ToolId): void;
  /** The Shape tool's selected kind. */
  shapeKind: ShapeKind;
  /** Sets the Shape tool's kind. */
  onShapeKind(kind: ShapeKind): void;
  /** Sticky note button: creates one note at the view centre. */
  onCreateSticky(): void;
  /** Story 12 (image.picker): the Image button opens the file picker
   *  (one-shot — it never becomes the active tool). */
  onAddImage(): void;
  /** Non-editable board: the creation tools are disabled (selection stays). */
  disabled?: boolean;
  /** Personal undo/redo (story 8); null while unavailable. */
  undo: UndoApi | null;
}

export function Toolbar(props: ToolbarProps): ReactElement {
  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="toolbar-tool"
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={props.tool === 'select'}
        onClick={() => props.onTool('select')}
      >
        {/* Cursor arrow. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 3l10 7-4.5.8L13 16l-2.4 1.2-2.4-5.2L5 15V3z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-tool"
        aria-label="Text (T)"
        title="Text – T"
        aria-pressed={props.tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onTool('text')}
      >
        {/* "T" glyph. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 4h12v3h-4.5v9h-3v-9H4V4z" fill="currentColor" />
        </svg>
      </button>
      {/* Shape button + its kind menu (Rectangle / Ellipse / Diamond). */}
      <div className="toolbar-shape-wrap">
        <button
          type="button"
          className="toolbar-tool"
          aria-label="Shape (S)"
          title="Shape – S"
          aria-pressed={props.tool === 'shape'}
          disabled={props.disabled}
          onClick={() => props.onTool('shape')}
        >
          {/* Rectangle glyph. */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3.5" y="5" width="13" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
        {props.tool === 'shape' && (
          <div className="shape-kind-menu" data-testid="shape-menu" role="menu" aria-label="Shape kind">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="menuitemradio"
                aria-checked={props.shapeKind === k}
                aria-label={SHAPE_KIND_LABELS[k]}
                className={props.shapeKind === k ? 'shape-kind-menu-item shape-kind-menu-item--active' : 'shape-kind-menu-item'}
                onClick={() => props.onShapeKind(k)}
              >
                {SHAPE_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="toolbar-tool"
        aria-label="Connector (L)"
        title="Connector – L"
        aria-pressed={props.tool === 'connector'}
        disabled={props.disabled}
        onClick={() => props.onTool('connector')}
      >
        {/* Arrow glyph. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M3.5 16.5h12m0 0l-4-4m4 4l-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {/* Story 11: the Pen tool (P); sticky until Escape / another tool. */}
      <button
        type="button"
        className="toolbar-tool"
        aria-label="Pen (P)"
        title="Pen – P"
        aria-pressed={props.tool === 'pen'}
        disabled={props.disabled}
        onClick={() => props.onTool('pen')}
      >
        {/* Pen nib glyph. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M4 16l1-4L13.5 3.5a1.8 1.8 0 012.5 0l.5.5a1.8 1.8 0 010 2.5L8 15l-4 1z"
            fill="currentColor"
          />
        </svg>
      </button>
      {/* Story 12 (image.picker): the Image button — one-shot picker, not a tool. */}
      <button
        type="button"
        className="toolbar-sticky"
        aria-label="Image (I)"
        title="Image – I"
        disabled={props.disabled}
        onClick={() => props.onAddImage()}
        data-testid="toolbar-image"
      >
        {/* Picture glyph. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="3" y="4" width="14" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="7.5" cy="8.5" r="1.6" fill="currentColor" />
          <path d="M4 14l4-4 3 3 3-3 2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-sticky"
        aria-label="Sticky note"
        title="Sticky note"
        disabled={props.disabled}
        onClick={() => props.onCreateSticky()}
      >
        {/* Sticky note square. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 3h12v9l-4 5H4V3z" fill="currentColor" />
        </svg>
      </button>
      {props.undo !== null && <UndoButtons {...props.undo} />}
    </div>
  );
}
