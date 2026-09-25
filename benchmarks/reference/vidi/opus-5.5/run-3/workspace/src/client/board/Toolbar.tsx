import type { ReactElement, SyntheticEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { useUndo } from './useUndo';
import type { ToolId } from '../tools/useActiveTool';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import { SHAPE_KIND_NAMES } from '../objects/ShapeObject';

const KIND_ICONS: Record<ShapeKind, ReactElement> = {
  rect: <rect x="4" y="6" width="14" height="10" rx="1" />,
  ellipse: <ellipse cx="11" cy="11" rx="7.5" ry="5.5" />,
  diamond: <path d="M11 3.5L18.5 11 11 18.5 3.5 11z" />,
};

function KindIcon(props: { kind: ShapeKind }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      {KIND_ICONS[props.kind]}
    </svg>
  );
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Fixed left-side toolbar: the Select and Text tools (story 9), the Shape and Connector tools (story 10) and the
 * Pen (story 11) when `tool` is given, the Image tool (story 12) when `onImage` is given, the Sticky note button,
 * then Undo and Redo (story 8) when `undo` is given.
 * The active tool's button is pressed. While the Shape tool is active a small menu next to its button chooses the kind.
 */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: ReturnType<typeof useUndo>;
  tool?: ToolId;
  onTool?(t: ToolId): void;
  shapeKind?: ShapeKind;
  onShapeKind?(k: ShapeKind): void;
  /** Image tool (story 12): opens the file picker. */
  onImage?(): void;
}) {
  const shapeKind = props.shapeKind ?? SHAPE_KINDS[0];
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {props.tool && (
        <>
          <button
            type="button"
            className="toolbar__button"
            aria-label="Select (V)"
            title="Select (V)"
            aria-pressed={props.tool === 'select'}
            onClick={() => props.onTool?.('select')}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path
                d="M5 3l12 7.5-5.2 1.2L9.3 17z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar__button"
            aria-label="Text (T)"
            title="Text (T)"
            aria-pressed={props.tool === 'text'}
            disabled={props.disabled}
            onClick={() => props.onTool?.('text')}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path
                d="M4.5 5.5V4h13v1.5M11 4v14M8 18h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="toolbar__group">
            <button
              type="button"
              className="toolbar__button"
              aria-label="Shape (S)"
              title="Shape (S)"
              aria-pressed={props.tool === 'shape'}
              aria-haspopup="menu"
              aria-expanded={props.tool === 'shape'}
              disabled={props.disabled}
              onClick={() => props.onTool?.('shape')}
            >
              <KindIcon kind={shapeKind} />
            </button>
            {props.tool === 'shape' && (
              <div className="toolbar__menu" role="menu" aria-label="Shape kind">
                {SHAPE_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitemradio"
                    className="toolbar__button toolbar__menu-item"
                    aria-label={SHAPE_KIND_NAMES[k]}
                    title={SHAPE_KIND_NAMES[k]}
                    aria-checked={shapeKind === k}
                    onClick={() => props.onShapeKind?.(k)}
                  >
                    <KindIcon kind={k} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="toolbar__button"
            aria-label="Connector (L)"
            title="Connector (L)"
            aria-pressed={props.tool === 'connector'}
            disabled={props.disabled}
            onClick={() => props.onTool?.('connector')}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path d="M4.5 17.5L16 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M10.5 5.5h6v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar__button"
            aria-label="Pen (P)"
            title="Pen (P)"
            aria-pressed={props.tool === 'pen'}
            disabled={props.disabled}
            onClick={() => props.onTool?.('pen')}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path
                d="M14.5 4.5l3 3L8 17l-4 1 1-4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M12.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </>
      )}
      {props.onImage && (
        <button
          type="button"
          className="toolbar__button"
          aria-label="Image (I)"
          title="Image (I)"
          disabled={props.disabled}
          onClick={props.onImage}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <rect x="3" y="4" width="16" height="14" rx="1.5" />
            <circle cx="8" cy="8.5" r="1.5" />
            <path d="M3.5 16l4.5-4.5 3.5 3.5 2-2 4.5 4.5" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="toolbar__button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 3h16v11l-5 5H3z" fill="#FFF59D" stroke="#1f2330" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M14 19v-5h5" fill="none" stroke="#1f2330" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {props.undo && (
        <>
          <div className="toolbar__divider" aria-hidden="true" />
          <UndoButtons {...props.undo} />
        </>
      )}
    </div>
  );
}
