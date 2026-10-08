// Toolbar (story 2, sticky.toolbar contract; extended in story 9,
// tool.select / tool.text; extended in story 10, shape.ui / connector.ui):
// the fixed left toolbar with the Select (V), Text (T) tool buttons, the
// Sticky note (N) button, the Shape (S) button with its kind menu and the
// Connector (L) button.

import type { JSX } from 'react';
import {
  SHAPE_KINDS,
  SHAPE_LABELS,
  type ShapeKind,
} from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';

export interface ToolbarProps {
  /** The active tool (aria-pressed on the tool buttons). */
  tool: ToolId;
  /** The chosen shape kind (the Shape menu's selected entry). */
  shapeKind: ShapeKind;
  onSelectTool(t: ToolId): void;
  onSelectShapeKind(k: ShapeKind): void;
  onCreateSticky(): void;
  /** Disable the tool buttons (story 4: board load failed). */
  disabled?: boolean;
  /** Rendered below the tools (story 8: the Undo/Redo buttons). */
  extra?: JSX.Element;
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

export function Toolbar(
  props: ToolbarProps,
): JSX.Element {
  const {
    tool,
    shapeKind,
    onSelectTool,
    onSelectShapeKind,
    onCreateSticky,
    disabled = false,
    extra,
  } = props;
  return (
    <>
      <div
        className="toolbar"
        role="toolbar"
        aria-label="Board tools"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="toolbar__tool"
          aria-label="Select (V)"
          aria-pressed={tool === 'select'}
          title="Select (V)"
          onClick={() => onSelectTool('select')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M5 3l11 6.5-4.6 1.3L13 16l-2.4 1-1.6-5.2L5 15V3z"
              fill="#3c4043"
              stroke="#202124"
              strokeWidth="0.75"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="toolbar__tool"
          aria-label="Text (T)"
          aria-pressed={tool === 'text'}
          title="Text (T)"
          disabled={disabled}
          onClick={() => onSelectTool('text')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M4 5V3h12v2M10 3v14m-3 0h6"
              stroke="#3c4043"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="toolbar__sticky"
          aria-label="Sticky note (N)"
          title={STICKY_BUTTON_TOOLTIP}
          disabled={disabled}
          onClick={onCreateSticky}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="14" height="14" rx="1.5" fill="#FFF59D" stroke="#b5a642" />
            <path d="M10 3v8h7" fill="#e8d873" stroke="#b5a642" strokeWidth="0.75" />
          </svg>
        </button>
        <button
          type="button"
          className="toolbar__tool"
          aria-label="Shape (S)"
          aria-pressed={tool === 'shape'}
          title="Shape (S)"
          disabled={disabled}
          onClick={() => onSelectTool('shape')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect
              x="4"
              y="5"
              width="12"
              height="10"
              rx="1"
              fill="#BBDEFB"
              stroke="#263238"
              strokeWidth="1.25"
            />
          </svg>
        </button>
        <button
          type="button"
          className="toolbar__tool"
          aria-label="Connector (L)"
          aria-pressed={tool === 'connector'}
          title="Connector (L)"
          disabled={disabled}
          onClick={() => onSelectTool('connector')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 16L15 5M15 5h-5.5M15 5v5.5"
              stroke="#3c4043"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {extra}
      </div>
      {tool === 'shape' && (
        <div
          className="shape-kind-menu"
          role="menu"
          aria-label="Shape kind"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {SHAPE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitemradio"
              className="shape-kind-menu__item"
              aria-label={SHAPE_LABELS[k]}
              aria-checked={shapeKind === k}
              data-testid={`shape-kind-${k}`}
              onClick={() => onSelectShapeKind(k)}
            >
              {SHAPE_LABELS[k]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
