import type { ReactNode } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';
import type { ToolId } from '../tools/useActiveTool';

const SHAPE_MENU: Array<{ kind: ShapeKind; label: string }> = [
  { kind: 'rect', label: 'Rectangle' }, { kind: 'ellipse', label: 'Ellipse' }, { kind: 'diamond', label: 'Diamond' },
];

export function Toolbar(props: {
  onCreateSticky(): void; disabled?: boolean; undoButtons?: ReactNode;
  tool?: ToolId; onTool?(t: ToolId): void;
  shapeKind?: ShapeKind; onShapeKind?(k: ShapeKind): void;
}) {
  const { tool = 'select', onTool, shapeKind = 'rect' } = props;
  return (
    <div className="left-toolbar" role="toolbar" aria-label="Tools" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => onTool?.('select')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={props.disabled}
        onClick={() => onTool?.('text')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 6V4h14v2M12 4v16M9 20h6" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 4h16v10l-6 6H4z M14 20v-6h6" />
        </svg>
      </button>
      <div className="tool-with-menu">
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          aria-haspopup="menu"
          aria-expanded={tool === 'shape'}
          disabled={props.disabled}
          onClick={() => onTool?.('shape')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="5" width="12" height="10" /><circle cx="16" cy="16" r="5" />
          </svg>
        </button>
        {tool === 'shape' && (
          <div className="tool-menu" role="menu" aria-label="Shape kind">
            {SHAPE_MENU.map((m) => (
              <button
                key={m.kind}
                type="button"
                role="menuitemradio"
                aria-checked={shapeKind === m.kind}
                onClick={() => props.onShapeKind?.(m.kind)}
              >
                {m.label}
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
        onClick={() => onTool?.('connector')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 20L19 5M11 5h8v8" />
        </svg>
      </button>
      {props.undoButtons}
    </div>
  );
}
