import type { ShapeKind } from '../../shared/board-model';
import { SHAPE_KINDS } from '../../shared/config';
import {
  CONNECTOR_TOOL_LABEL,
  IMAGE_TOOL_LABEL,
  PEN_TOOL_LABEL,
  SHAPE_KIND_LABELS,
  SHAPE_TOOL_LABEL,
} from '../tools/useActiveTool';
import { UndoButtons } from './UndoButtons';
import type { UndoControls } from './useUndo';
import { SELECT_TOOL_LABEL, TEXT_TOOL_LABEL, type Tool } from './useTool';

/** Accessible name of the shape kind menu shown next to the Shape button. */
export const SHAPE_MENU_LABEL = 'Shape kind';

/** Small icon per shape kind (toolbar button and menu). */
function ShapeKindIcon({ kind }: { kind: ShapeKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' as const };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === 'rect' && <rect x="4" y="6" width="16" height="12" rx="1" {...common} />}
      {kind === 'ellipse' && <ellipse cx="12" cy="12" rx="8.5" ry="6.5" {...common} />}
      {kind === 'diamond' && <path d="M12 3l9 9-9 9-9-9z" {...common} />}
    </svg>
  );
}

export const STICKY_BUTTON_LABEL = 'Sticky note';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited (its saved state could not be loaded). */
  disabled?: boolean;
  /** Undo and Redo buttons below the tools (story 8); omitted when absent. */
  undo?: UndoControls;
  /** The active tool (story 9); Select when absent. */
  tool?: Tool;
  /** Chooses a tool; without it the Select and Text buttons are not shown. */
  onTool?(t: Tool): void;
  /** The Shape tool's kind (story 10); without `onShapeKind` the Shape and Connector buttons are not shown. */
  shapeKind?: ShapeKind;
  onShapeKind?(k: ShapeKind): void;
  /** Opens the image file picker (story 12); without it the Image button is not shown. */
  onImage?(): void;
}

/** Left-side vertical tool bar. */
export function Toolbar({
  onCreateSticky,
  disabled = false,
  undo,
  tool = 'select',
  onTool,
  shapeKind = SHAPE_KINDS[0],
  onShapeKind,
  onImage,
}: ToolbarProps) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {onTool && (
        <>
          <button
            type="button"
            className="toolbar__button"
            aria-label={SELECT_TOOL_LABEL}
            title={SELECT_TOOL_LABEL}
            aria-pressed={tool === 'select'}
            onClick={() => onTool('select')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
            className="toolbar__button"
            aria-label={TEXT_TOOL_LABEL}
            title={TEXT_TOOL_LABEL}
            aria-pressed={tool === 'text'}
            disabled={disabled}
            onClick={() => onTool('text')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
          {onShapeKind && (
            <>
              <div className="toolbar__anchor">
                <button
                  type="button"
                  className="toolbar__button"
                  aria-label={SHAPE_TOOL_LABEL}
                  title={SHAPE_TOOL_LABEL}
                  aria-pressed={tool === 'shape'}
                  aria-haspopup="menu"
                  aria-expanded={tool === 'shape'}
                  disabled={disabled}
                  onClick={() => onTool('shape')}
                >
                  <ShapeKindIcon kind={shapeKind} />
                </button>
                {tool === 'shape' && (
                  <div className="toolbar__menu" role="menu" aria-label={SHAPE_MENU_LABEL}>
                    {SHAPE_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="menuitemradio"
                        className="toolbar__menu-item"
                        aria-checked={k === shapeKind}
                        onClick={() => onShapeKind(k)}
                      >
                        <ShapeKindIcon kind={k} />
                        <span>{SHAPE_KIND_LABELS[k]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="toolbar__button"
                aria-label={CONNECTOR_TOOL_LABEL}
                title={CONNECTOR_TOOL_LABEL}
                aria-pressed={tool === 'connector'}
                disabled={disabled}
                onClick={() => onTool('connector')}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
              <button
                type="button"
                className="toolbar__button"
                aria-label={PEN_TOOL_LABEL}
                title={PEN_TOOL_LABEL}
                aria-pressed={tool === 'pen'}
                disabled={disabled}
                onClick={() => onTool('pen')}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M4 20l1.2-4.2L15.8 5.2a2 2 0 012.8 0l.2.2a2 2 0 010 2.8L8.2 18.8zM14 7l3 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          )}
        </>
      )}
      <button
        type="button"
        className="toolbar__button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        onClick={onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 4h16v11l-5 5H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M20 15h-5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      {onImage && (
        <button
          type="button"
          className="toolbar__button"
          aria-label={IMAGE_TOOL_LABEL}
          title={IMAGE_TOOL_LABEL}
          disabled={disabled}
          onClick={onImage}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="9" cy="10" r="1.8" fill="currentColor" />
            <path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
