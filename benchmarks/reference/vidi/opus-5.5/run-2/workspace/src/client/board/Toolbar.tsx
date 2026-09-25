/**
 * Fixed left-side toolbar: the Select (V), Text (T), Shape (S), Connector (L) and Pen (P) tools with
 * their pressed state (anchors: text.tool_ui, tools.active_tool), the Image (I) button that
 * opens the file picker (story 12, anchor: image.pick), the Sticky note button
 * (anchor: sticky.toolbar) and, below the tools, the Undo and Redo buttons (anchor:
 * undo.buttons). While the Shape tool is active a small menu next to its button picks the
 * kind (Rectangle, Ellipse, Diamond).
 */
import type { PointerEvent, WheelEvent } from 'react';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import { SHAPE_KIND_NAMES } from '../objects/ShapeObject';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';

const SHAPE_ICONS: Record<ShapeKind, React.JSX.Element> = {
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" strokeLinejoin="round" />,
};

function ShapeIcon(props: { kind: ShapeKind }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8">
      {SHAPE_ICONS[props.kind]}
    </svg>
  );
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited: Sticky note and Text are disabled. */
  disabled?: boolean;
  undo?: UndoApi;
  /** Active tool; the tool buttons are shown when `onTool` is given. */
  tool?: ToolId;
  onTool?(t: ToolId): void;
  /** Kind the Shape tool draws (story 10). */
  shapeKind?: ShapeKind;
  onShapeKind?(k: ShapeKind): void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const tool = props.tool ?? 'select';
  const onTool = props.onTool;
  const shapeKind = props.shapeKind ?? 'rect';
  // The toolbar is not board space: pointer and wheel input here never reach the board.
  const stop = (e: PointerEvent | WheelEvent) => e.stopPropagation();
  return (
    <div
      className="board-toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      data-testid="board-toolbar"
      onPointerDown={stop}
      onWheel={stop}
    >
      {onTool !== undefined && (
        <>
          <button
            type="button"
            aria-label="Select (V)"
            title="Select (V)"
            aria-pressed={tool === 'select'}
            onClick={() => onTool('select')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path
                d="M6 3l12 9-5.5 1 3 6.5-2.5 1.2-3-6.5L6 18z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Text (T)"
            title="Text (T)"
            aria-pressed={tool === 'text'}
            disabled={props.disabled === true}
            onClick={() => onTool('text')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <div className="toolbar-shape">
            <button
              type="button"
              aria-label="Shape (S)"
              title="Shape (S)"
              aria-pressed={tool === 'shape'}
              aria-haspopup="menu"
              aria-expanded={tool === 'shape'}
              disabled={props.disabled === true}
              onClick={() => onTool('shape')}
            >
              <ShapeIcon kind={shapeKind} />
            </button>
            {tool === 'shape' && (
              <div className="shape-kind-menu" role="menu" aria-label="Shape kind" data-testid="shape-kind-menu">
                {SHAPE_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitemradio"
                    aria-checked={shapeKind === k}
                    aria-label={SHAPE_KIND_NAMES[k]}
                    title={SHAPE_KIND_NAMES[k]}
                    onClick={() => props.onShapeKind?.(k)}
                  >
                    <ShapeIcon kind={k} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Connector (L)"
            title="Connector (L)"
            aria-pressed={tool === 'connector'}
            disabled={props.disabled === true}
            onClick={() => onTool('connector')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path d="M5 19L18 6M18 6h-6M18 6v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Pen (P)"
            title="Pen (P)"
            aria-pressed={tool === 'pen'}
            disabled={props.disabled === true}
            onClick={() => onTool('pen')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path
                d="M4 20l1.2-4.4L16.5 4.3a1.8 1.8 0 012.6 0l.6.6a1.8 1.8 0 010 2.6L8.4 18.8zM14.5 6.3l3.2 3.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Image (I)"
            title="Image (I)"
            disabled={props.disabled === true}
            onClick={() => onTool('image')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="9" cy="10" r="1.8" fill="currentColor" />
              <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled === true}
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path
            d="M4 4h16v10l-6 6H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      {props.undo !== undefined && <UndoButtons {...props.undo} />}
    </div>
  );
}
