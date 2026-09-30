import type { JSX } from 'react';

import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';
import type { ShapeKind } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UndoButtonsProps;
  /** Current active tool */
  tool?: Tool;
  /** Set the active tool */
  onToolChange?(tool: Tool): void;
  /** Current shape kind (for the Shape menu) */
  shapeKind?: ShapeKind;
  /** Set the shape kind */
  onShapeKindChange?(kind: ShapeKind): void;
  /** Open the image file picker (Image button / I shortcut). */
  onImagePicker?(): void;
}

/** The tooltip of the Sticky note button, exactly as the product names it. */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

/**
 * The left-side board toolbar: Select, Text, Sticky note tool buttons + undo.
 *
 * Pointer events stop at the toolbar so clicking a tool never reaches the board
 * (which would pan it or clear the selection).
 */
export function Toolbar({
  onCreateSticky,
  disabled,
  undo,
  tool = 'select',
  onToolChange,
  shapeKind = 'rect',
  onShapeKindChange,
  onImagePicker,
}: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        onClick={() => onToolChange?.('select')}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 2l12 9.5-5.5 1.2L13 18l-2.5 1-2.5-5.2L4 17V2z"
          />
        </svg>
        <span>Select</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        onClick={() => onToolChange?.('text')}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 4h12v3h-2V6h-3v9h2v2H7v-2h2V6H6v1H4V4z"
          />
        </svg>
        <span>Text</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 3.75A.75.75 0 0 1 4.75 3h7.69c.2 0 .39.08.53.22l3.81 3.81c.14.14.22.33.22.53v8.69a.75.75 0 0 1-.75.75H4.75a.75.75 0 0 1-.75-.75Zm1.5.75v11h11V8h-3.25a.75.75 0 0 1-.75-.75V4.5ZM13.5 6.5H16l-2.5-2.5Z"
          />
        </svg>
        <span>Sticky note</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-shape"
        aria-label="Shape (S)"
        aria-pressed={tool === 'shape'}
        title="Shape (S)"
        onClick={() => onToolChange?.('shape')}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Shape</span>
      </button>
      {tool === 'shape' && (
        <div className="board-toolbar__shape-menu" data-testid="shape-kind-menu" role="menu" aria-label="Shape kind">
          <button type="button" role="menuitem" data-testid="shape-kind-rect" aria-label="Rectangle" aria-pressed={shapeKind === 'rect'} onClick={() => onShapeKindChange?.('rect')}>Rectangle</button>
          <button type="button" role="menuitem" data-testid="shape-kind-ellipse" aria-label="Ellipse" aria-pressed={shapeKind === 'ellipse'} onClick={() => onShapeKindChange?.('ellipse')}>Ellipse</button>
          <button type="button" role="menuitem" data-testid="shape-kind-diamond" aria-label="Diamond" aria-pressed={shapeKind === 'diamond'} onClick={() => onShapeKindChange?.('diamond')}>Diamond</button>
        </div>
      )}
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        title="Connector (L)"
        onClick={() => onToolChange?.('connector')}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="1.5" />
          <polygon points="17,3 12,5 15,8" fill="currentColor" />
        </svg>
        <span>Connector</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-pen"
        aria-label="Pen (P)"
        aria-pressed={tool === 'pen'}
        title="Pen (P)"
        onClick={() => onToolChange?.('pen')}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M3 17l1-4L15 2l3 3L7 16l-4 1z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Pen</span>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-image"
        aria-label="Image (I)"
        title="Image (I)"
        onClick={() => onImagePicker?.()}
        disabled={disabled}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <rect x="2" y="3" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="8" r="1.5" fill="currentColor" />
          <path d="M3 15l4-4 3 3 4-4 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Image</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
