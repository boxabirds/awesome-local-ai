// Story 2: the fixed left-side board toolbar (anchor: sticky.toolbar) with
// the Sticky note button.
//
// Story 8: also hosts the Undo/Redo buttons (anchor: undo.buttons).
//
// Story 9: the Select (V) and Text (T) tool buttons join the Sticky note
// button (N); the active tool is highlighted (aria-pressed, text.tool_ui).
//
// Story 10 (tools.active, shape.button): the Shape (S) and Connector (L)
// tool buttons join the toolbar. The Shape button carries the kind menu
// (Rectangle / Ellipse / Diamond), open while the shape tool is active, with
// the current kind shown as pressed.

import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { ShapeKind } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { UndoBinding } from './useUndo';
import type { Tool } from './useTool';

const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

const SHAPE_KINDS: readonly ShapeKind[] = ['rect', 'ellipse', 'diamond'];

export function Toolbar(
  props: {
    onCreateSticky: () => void;
    canEdit: boolean;
    tool: Tool;
    setTool(tool: Tool): void;
    shapeKind: ShapeKind;
    setShapeKind(kind: ShapeKind): void;
    /** Story 12: open the image picker (I); the tool returns to Select. */
    onImage?: () => void;
  } & UndoBinding,
): JSX.Element {
  const stop = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.stopPropagation();
  };
  const shapeActive = props.tool === 'shape';
  return (
    <div
      className="board-toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
    >
      <button
        type="button"
        className="board-toolbar__tool"
        title="Select – V"
        aria-label="Select (V)"
        aria-pressed={props.tool === 'select'}
        onClick={() => props.setTool('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M5 3l10 6.5-4.5 1.2 2.6 5.1-2.3 1.2-2.6-5.1L5 15V3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__tool"
        title={props.canEdit ? 'Text – T' : 'Board unavailable'}
        aria-label="Text (T)"
        aria-pressed={props.tool === 'text'}
        disabled={!props.canEdit}
        onClick={() => props.setTool('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 5V3h12v2M10 3v14M7 17h6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="board-toolbar__shape">
        <button
          type="button"
          className="board-toolbar__tool"
          title={props.canEdit ? 'Shape – S' : 'Board unavailable'}
          aria-label="Shape (S)"
          aria-pressed={shapeActive}
          disabled={!props.canEdit}
          onClick={() => props.setTool('shape')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <rect
              x="3"
              y="3"
              width="14"
              height="14"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        {shapeActive && (
          <div className="shape-kind-menu" role="menu" aria-label="Shape kind">
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="menuitemradio"
                aria-label={SHAPE_KIND_LABELS[kind]}
                aria-checked={props.shapeKind === kind}
                onClick={() => props.setShapeKind(kind)}
              >
                {SHAPE_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="board-toolbar__tool"
        title={props.canEdit ? 'Connector – L' : 'Board unavailable'}
        aria-label="Connector (L)"
        aria-pressed={props.tool === 'connector'}
        disabled={!props.canEdit}
        onClick={() => props.setTool('connector')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 17L15 5M15 5h-5M15 5v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__tool"
        title={props.canEdit ? 'Pen – P' : 'Board unavailable'}
        aria-label="Pen (P)"
        aria-pressed={props.tool === 'pen'}
        disabled={!props.canEdit}
        onClick={() => props.setTool('pen')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M13.5 3.5l3 3L7 16H4v-3L13.5 3.5zM11 6l3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__tool"
        title={props.canEdit ? 'Image – I' : 'Board unavailable'}
        aria-label="Image (I)"
        disabled={!props.canEdit}
        onClick={props.onImage}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect
            x="3"
            y="4"
            width="14"
            height="12"
            rx="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="7.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
          <path
            d="M4 14l4-4 3 3 2-2 3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__sticky"
        title={props.canEdit ? 'Sticky note – N' : 'Board unavailable'}
        aria-label="Sticky note"
        aria-disabled={props.canEdit ? undefined : true}
        disabled={!props.canEdit}
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v9l-5 5H3V3zm10 11.5V15h3.5L13 14.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      <UndoButtons {...props} />
    </div>
  );
}
