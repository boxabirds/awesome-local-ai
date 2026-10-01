import type { ReactNode } from 'react';
import type { ShapeKind } from '../../shared/board-model';
import type { Tool } from './useTool';

const SHAPE_KIND_LABELS: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'diamond', label: 'Diamond' },
];

export function Toolbar(props: {
  onCreateSticky(): void; disabled?: boolean; children?: ReactNode;
  tool?: Tool; onTool?(t: Tool): void;
  shapeKind?: ShapeKind; onShapeKind?(k: ShapeKind): void;
}) {
  const { tool = 'select', onTool, shapeKind = 'rect' } = props;
  return (
    <div
      className="left-toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => onTool?.('select')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M5 3l14 8-6 2-2 6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        onClick={() => onTool?.('text')}
        disabled={props.disabled}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={props.onCreateSticky}
        disabled={props.disabled}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M4 4h16v10l-6 6H4z M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="shape-menu-anchor">
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          aria-haspopup="menu"
          aria-expanded={tool === 'shape'}
          onClick={() => onTool?.('shape')}
          disabled={props.disabled}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="3" y="5" width="12" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="16" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
        {tool === 'shape' && (
          <div className="shape-menu" role="menu" aria-label="Shape kind">
            {SHAPE_KIND_LABELS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                role="menuitemradio"
                aria-checked={shapeKind === kind}
                onClick={() => props.onShapeKind?.(kind)}
              >
                {label}
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
        onClick={() => onTool?.('connector')}
        disabled={props.disabled}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M4 19L19 5M19 5h-7M19 5v7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {props.children}
    </div>
  );
}
