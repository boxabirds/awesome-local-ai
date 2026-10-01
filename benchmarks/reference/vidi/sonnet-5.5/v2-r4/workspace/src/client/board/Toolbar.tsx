import type { ReactNode } from 'react';
import type { Tool } from './useTool';

const BUTTON_STYLE = { width: 40, height: 40, border: 'none', borderRadius: 8 } as const;

export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  tool?: Tool;
  onTool?(t: Tool): void;
  children?: ReactNode;
}) {
  const tool = props.tool ?? 'select';
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
      {props.children}
    </div>
  );
}
