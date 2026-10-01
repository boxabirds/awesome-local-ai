import type { ReactNode } from 'react';
import type { ShapeKind } from '../../shared/config';
import type { Tool } from '../tools/useActiveTool';

const SHAPE_MENU: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'diamond', label: 'Diamond' },
];

const BUTTON_STYLE = { width: 40, height: 40, border: 'none', borderRadius: 8 } as const;

export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  tool?: Tool;
  onTool?(t: Tool): void;
  shapeKind?: ShapeKind;
  onShapeKind?(k: ShapeKind): void;
  children?: ReactNode;
}) {
  const tool = props.tool ?? 'select';
  const shapeKind = props.shapeKind ?? 'rect';
  const toolStyle = (active: boolean) => ({
    ...BUTTON_STYLE,
    background: active ? '#e3f2fd' : 'transparent',
    boxShadow: active ? 'inset 0 0 0 2px #1e88e5' : 'none',
    cursor: 'pointer',
  });
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: 20,
      }}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => props.onTool?.('select')}
        style={toolStyle(tool === 'select')}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" stroke="#444" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('text')}
        style={{ ...toolStyle(tool === 'text'), cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.4 : 1 }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 6V4h14v2M12 4v16M9 20h6" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
        style={{ ...BUTTON_STYLE, background: 'transparent', cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.4 : 1 }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#FFF59D" stroke="#444" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16v10l-6 6H4z" />
          <path d="M14 20v-6h6" fill="none" />
        </svg>
      </button>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Shape (S)"
          title="Shape (S)"
          aria-pressed={tool === 'shape'}
          aria-haspopup="menu"
          disabled={props.disabled}
          onClick={() => props.onTool?.('shape')}
          style={{ ...toolStyle(tool === 'shape'), cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#444" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="9" width="11" height="11" rx="1" />
            <circle cx="15.5" cy="8.5" r="5" />
          </svg>
        </button>
        {tool === 'shape' && (
          <div
            role="menu"
            aria-label="Shape kind"
            style={{ position: 'absolute', left: 'calc(100% + 10px)', top: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: 6, background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px rgba(0,0,0,0.2)', font: '14px system-ui, sans-serif' }}
          >
            {SHAPE_MENU.map((item) => (
              <button
                key={item.kind}
                type="button"
                role="menuitemradio"
                aria-label={item.label}
                aria-checked={shapeKind === item.kind}
                onClick={() => props.onShapeKind?.(item.kind)}
                style={{ border: 'none', borderRadius: 6, padding: '6px 12px', textAlign: 'left', cursor: 'pointer', background: shapeKind === item.kind ? '#e3f2fd' : 'transparent', boxShadow: shapeKind === item.kind ? 'inset 0 0 0 2px #1e88e5' : 'none' }}
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
        disabled={props.disabled}
        onClick={() => props.onTool?.('connector')}
        style={{ ...toolStyle(tool === 'connector'), cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.4 : 1 }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 19L19 5M19 5h-7M19 5v7" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Pen (P)"
        title="Pen (P)"
        aria-pressed={tool === 'pen'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('pen')}
        style={{ ...toolStyle(tool === 'pen'), cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.4 : 1 }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 20l1-4L16 5l3 3L8 19z" />
          <path d="M14 7l3 3" />
        </svg>
      </button>
      {props.children}
    </div>
  );
}
