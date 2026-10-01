import type { ReactNode } from 'react';
import type { Tool } from './useTool';

export function Toolbar(props: {
  onCreateSticky(): void; disabled?: boolean; children?: ReactNode;
  tool?: Tool; onTool?(t: Tool): void;
}) {
  const { tool = 'select', onTool } = props;
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
      {props.children}
    </div>
  );
}
