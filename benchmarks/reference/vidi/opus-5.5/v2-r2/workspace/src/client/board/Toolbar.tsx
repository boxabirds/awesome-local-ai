import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import { SHAPE_KIND_NAMES } from '../objects/ShapeObject';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { useUndo } from './useUndo';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

const KIND_ICONS: Record<ShapeKind, React.JSX.Element> = {
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  diamond: <polygon points="12,4 20,12 12,20 4,12" />,
};

/**
 * Fixed left-side vertical toolbar: Select, Text, Shape (with its kind menu
 * while active), Connector and Pen tools, Image (file picker), Sticky note, then Undo and Redo.
 */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: ReturnType<typeof useUndo>;
  /** The active tool (highlighted); omitted → Select. */
  tool?: Tool;
  onTool?(t: Tool): void;
  /** Kind drawn by the Shape tool (shown selected in its menu). */
  shapeKind?: ShapeKind;
  onShapeKind?(k: ShapeKind): void;
  /** Image tool: opens the file picker (story 12). */
  onImage?(): void;
}): React.JSX.Element {
  const tool = props.tool ?? 'select';
  const shapeKind = props.shapeKind ?? 'rect';
  return (
    <div
      className="board-toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => props.onTool?.('select')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M6 3l12 9.5-5.5 1 3.2 6.3-2.4 1.2-3.2-6.4L6 18.5V3Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('text')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M5 5h14v3h-2V7h-4v11h2v2H9v-2h2V7H7v1H5V5Z" fill="currentColor" />
        </svg>
      </button>
      <div className="board-toolbar-shape">
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          aria-haspopup="true"
          aria-expanded={tool === 'shape'}
          disabled={props.disabled}
          onClick={() => props.onTool?.('shape')}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8">
            {KIND_ICONS[shapeKind]}
          </svg>
        </button>
        {tool === 'shape' && (
          <div className="shape-kind-menu" role="group" aria-label="Shape kind">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-label={SHAPE_KIND_NAMES[k]}
                title={SHAPE_KIND_NAMES[k]}
                aria-pressed={shapeKind === k}
                data-kind={k}
                onClick={() => props.onShapeKind?.(k)}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8">
                  {KIND_ICONS[k]}
                </svg>
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
        disabled={props.disabled}
        onClick={() => props.onTool?.('connector')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M5 19 17.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M19.5 4.5 18 11l-4.5-4.5 6-2Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Pen (P)"
        title="Pen (P)"
        aria-pressed={tool === 'pen'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('pen')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8 4 20Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M14 6.6l3.4 3.4" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Image (I)"
        title="Image (I)"
        disabled={props.disabled}
        onClick={props.onImage}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="9" cy="9.5" r="1.8" fill="currentColor" />
          <path d="M4 18l5-5 3.5 3.5L15 14l5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M4 4h16v10l-6 6H4V4Z" fill="#FFF59D" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {props.undo && (
        <>
          <span className="board-toolbar-divider" aria-hidden="true" />
          <UndoButtons {...props.undo} />
        </>
      )}
    </div>
  );
}
