// Left-side board toolbar (see spec: sticky.toolbar, board.text_tool,
// tools.active_tool, shape.ui, connector.ui, undo.buttons). Fixed position;
// the tool buttons (Select V, Text T, Sticky note, Shape S with kind menu,
// Connector L) and below them the Undo and Redo buttons (story 8), disabled
// while the matching history is empty.

import type { JSX } from 'react';
import type { UndoUi } from './useUndo';
import { UndoButtons } from './UndoButtons';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import type { ToolId } from '../tools/useActiveTool';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';
export const SELECT_TOOL_ARIA = 'Select (V)';
export const TEXT_TOOL_ARIA = 'Text (T)';

export interface ToolbarProps {
  /** False while the board is load_failed: the buttons are disabled. */
  disabled?: boolean;
  /** Undo/redo state and actions for this tab's history (story 8). */
  undo: UndoUi;
  /** Active tool; reflected with aria-pressed. */
  tool?: ToolId;
  /** The kind the Shape tool draws (Shape menu selection). */
  shapeKind?: ShapeKind;
  onToolChange?: (tool: ToolId) => void;
  onShapeKindChange?: (kind: ShapeKind) => void;
  /** Story 12 (image.pick): opens the image file picker (I shortcut). */
  onOpenImagePicker?: () => void;
}

const KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

const KIND_ICONS: Record<ShapeKind, JSX.Element> = {
  rect: (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="14" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  ellipse: (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <ellipse cx="10" cy="10" rx="7" ry="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  diamond: (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 3l7 7-7 7-7-7z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
};

export function Toolbar({
  disabled = false,
  undo,
  tool = 'select',
  shapeKind = 'rect',
  onToolChange,
  onShapeKindChange,
  onOpenImagePicker,
}: ToolbarProps): JSX.Element {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-testid="toolbar"
      className="toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar-select"
        aria-label={SELECT_TOOL_ARIA}
        aria-pressed={tool === 'select'}
        title={SELECT_TOOL_ARIA}
        onClick={() => onToolChange?.('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 2l12 8.5-5.1.9L13 17l-2.3 1.4-2.1-5.4L4 17V2z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-text"
        aria-label={TEXT_TOOL_ARIA}
        aria-pressed={tool === 'text'}
        title={TEXT_TOOL_ARIA}
        disabled={disabled}
        onClick={() => onToolChange?.('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v3h-1.5V4.5H11V16h1.5V17.5H7.5V16H9V4.5H4.5V6H3V3z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        aria-pressed={tool === 'sticky'}
        disabled={disabled}
        onClick={() => onToolChange?.('sticky')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v9l-5 5H3V3zm11 11.5L15.5 14H14V11.5h-1.5V14H3v-11h11v7.5z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-shape"
        data-testid="shape"
        aria-label="Shape (S)"
        aria-pressed={tool === 'shape'}
        title="Shape (S)"
        disabled={disabled}
        onClick={() => onToolChange?.('shape')}
      >
        {KIND_ICONS[shapeKind]}
      </button>
      {tool === 'shape' && (
        <span
          data-testid="shape-kind-menu"
          className="shape-kind-menu"
          role="group"
          aria-label="Shape kind"
        >
          {SHAPE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className="shape-kind-menu__item"
              data-testid={`shape-kind-${k}`}
              aria-label={KIND_LABELS[k]}
              aria-pressed={shapeKind === k}
              title={KIND_LABELS[k]}
              onClick={() => onShapeKindChange?.(k)}
            >
              {KIND_ICONS[k]}
            </button>
          ))}
        </span>
      )}
      <button
        type="button"
        className="toolbar-connector"
        data-testid="connector"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector (L)"
        disabled={disabled}
        onClick={() => onToolChange?.('connector')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 17L15 5M15 5h-5m5 0v5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-pen"
        data-testid="pen"
        aria-label="Pen (P)"
        aria-pressed={tool === 'pen'}
        title="Pen (P)"
        disabled={disabled}
        onClick={() => onToolChange?.('pen')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M13.6 2.4l4 4L7 17l-5 1 1-5L13.6 2.4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-image"
        data-testid="image"
        aria-label="Image (I)"
        title="Image (I)"
        disabled={disabled}
        onClick={() => onOpenImagePicker?.()}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="14" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7.5" cy="8.5" r="1.5" fill="currentColor" />
          <path d="M3 14l4.5-4 4 3.5L15 10l2 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
