import type { SyntheticEvent } from 'react';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';
import { PenToolbar } from '../tools/PenToolbar';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { useUndo } from './useUndo';

export const STICKY_BUTTON_LABEL = 'Sticky note (N)';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';
export const SELECT_TOOL_LABEL = 'Select (V)';
export const TEXT_TOOL_LABEL = 'Text (T)';
export const SHAPE_TOOL_LABEL = 'Shape (S)';
export const CONNECTOR_TOOL_LABEL = 'Connector (L)';
export const PEN_TOOL_LABEL = 'Pen (P)';
export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

function ShapeKindIcon(props: { kind: ShapeKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      {props.kind === 'rect' && <rect x="4" y="6" width="16" height="12" rx="1" {...common} />}
      {props.kind === 'ellipse' && <ellipse cx="12" cy="12" rx="8" ry="6.5" {...common} />}
      {props.kind === 'diamond' && (
        <polygon points="12,3.5 20.5,12 12,20.5 3.5,12" strokeLinejoin="round" {...common} />
      )}
    </svg>
  );
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Fixed left-side toolbar: Select and Text tools (story 9), Shape (with its kind menu while
 * active) and Connector (story 10) and Pen (story 11, with its pen toolbar while active) when
 * `tool` is given, the Sticky note button, then Undo and Redo (story 8) when `undo` is given.
 */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: ReturnType<typeof useUndo>;
  tool?: ToolId;
  onTool?(t: ToolId): void;
  shapeKind?: ShapeKind;
  onShapeKind?(k: ShapeKind): void;
  pen?: {
    color: PenColor;
    thickness: PenThickness;
    onColor(c: PenColor): void;
    onThickness(t: PenThickness): void;
  };
}) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      {props.tool && (
        <>
          <button
            type="button"
            className="toolbar-button"
            aria-label={SELECT_TOOL_LABEL}
            title={SELECT_TOOL_LABEL}
            aria-pressed={props.tool === 'select'}
            onClick={() => props.onTool?.('select')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 3l12 9-5.5 1 3 6.5-2.5 1.2-3-6.6L6 18z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-label={TEXT_TOOL_LABEL}
            title={TEXT_TOOL_LABEL}
            aria-pressed={props.tool === 'text'}
            disabled={props.disabled}
            onClick={() => props.onTool?.('text')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 6V4h14v2M12 4v16M9 20h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="toolbar-menu-anchor">
            <button
              type="button"
              className="toolbar-button"
              aria-label={SHAPE_TOOL_LABEL}
              title={SHAPE_TOOL_LABEL}
              aria-pressed={props.tool === 'shape'}
              disabled={props.disabled}
              onClick={() => props.onTool?.('shape')}
            >
              <ShapeKindIcon kind={props.shapeKind ?? 'rect'} />
            </button>
            {props.tool === 'shape' && (
              <div className="toolbar-menu" role="group" aria-label="Shape kind">
                {SHAPE_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="toolbar-button"
                    aria-label={SHAPE_KIND_NAMES[kind]}
                    title={SHAPE_KIND_NAMES[kind]}
                    aria-pressed={(props.shapeKind ?? 'rect') === kind}
                    onClick={() => props.onShapeKind?.(kind)}
                  >
                    <ShapeKindIcon kind={kind} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="toolbar-button"
            aria-label={CONNECTOR_TOOL_LABEL}
            title={CONNECTOR_TOOL_LABEL}
            aria-pressed={props.tool === 'connector'}
            disabled={props.disabled}
            onClick={() => props.onTool?.('connector')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 19L18 6M11 6h7v7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="toolbar-menu-anchor">
            <button
              type="button"
              className="toolbar-button"
              aria-label={PEN_TOOL_LABEL}
              title={PEN_TOOL_LABEL}
              aria-pressed={props.tool === 'pen'}
              disabled={props.disabled}
              onClick={() => props.onTool?.('pen')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 20l1.2-4.6L15.8 4.8a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8zM14 6.6l3.4 3.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {props.tool === 'pen' && props.pen && (
              <PenToolbar
                color={props.pen.color}
                thickness={props.pen.thickness}
                onColor={props.pen.onColor}
                onThickness={props.pen.onThickness}
              />
            )}
          </div>
        </>
      )}
      <button
        type="button"
        className="toolbar-button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 4h16v11l-5 5H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M20 15h-5v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {props.undo && <UndoButtons {...props.undo} />}
    </div>
  );
}
