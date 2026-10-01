import type { ShapeKind } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { useUndo } from './useUndo';

const SHAPE_MENU: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'diamond', label: 'Diamond' },
];

export function Toolbar(props: {
  shapeKind?: ShapeKind;
  onShapeKind?(kind: ShapeKind): void;
  onCreateSticky(): void;
  /** Image button: opens the file picker (the tool stays Select). */
  onPickImage?(): void;
  disabled?: boolean;
  undo?: ReturnType<typeof useUndo>;
  tool?: Tool;
  onTool?(tool: Tool): void;
}) {
  const tool = props.tool ?? 'select';
  return (
    <div
      className="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        className={tool === 'select' ? 'tool-active' : undefined}
        onClick={() => props.onTool?.('select')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        className={tool === 'text' ? 'tool-active' : undefined}
        disabled={props.disabled}
        onClick={() => props.onTool?.('text')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 6V4h14v2M12 4v16M9 20h6" />
        </svg>
      </button>
      <div className="tool-with-menu">
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          className={tool === 'shape' ? 'tool-active' : undefined}
          disabled={props.disabled}
          onClick={() => props.onTool?.('shape')}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="11" height="11" />
            <circle cx="15" cy="15" r="6" />
          </svg>
        </button>
        {tool === 'shape' && (
          <div className="tool-menu" role="group" aria-label="Shape kind">
            {SHAPE_MENU.map((item) => (
              <button
                key={item.kind}
                type="button"
                className="tool-menu-item"
                aria-label={item.label}
                aria-pressed={(props.shapeKind ?? 'rect') === item.kind}
                onClick={() => props.onShapeKind?.(item.kind)}
              >
                {item.label}
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
        className={tool === 'connector' ? 'tool-active' : undefined}
        disabled={props.disabled}
        onClick={() => props.onTool?.('connector')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 20L20 4M20 4h-7M20 4v7" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Pen (P)"
        title="Pen (P)"
        aria-pressed={tool === 'pen'}
        className={tool === 'pen' ? 'tool-active' : undefined}
        disabled={props.disabled}
        onClick={() => props.onTool?.('pen')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Image (I)"
        title="Image (I)"
        disabled={props.disabled}
        onClick={props.onPickImage}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 17l5-5 4 4 3-3 6 6M9 9h.01" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16v10l-6 6H4zM14 20v-6h6" />
        </svg>
      </button>
      {props.undo && <UndoButtons {...props.undo} />}
    </div>
  );
}
