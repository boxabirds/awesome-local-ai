import type { ReactNode } from 'react';
import type { Tool } from './useTool';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

/** Left-side vertical toolbar: Select and Text tools (story 9), Sticky note, then children (undo). */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  tool?: Tool;
  onTool?(t: Tool): void;
  children?: ReactNode;
}) {
  const tool = props.tool ?? 'select';
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => props.onTool?.('select')}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path
            d="M6 3.5v14l3.6-3.4 2.5 5.4 2.3-1-2.5-5.3 4.9-.2L6 3.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('text')}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path
            d="M5 5.5h12M11 5.5v12M8.5 17.5h5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
          <path
            d="M4 3.5h14a.5.5 0 0 1 .5.5v9.5l-5 5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M18.5 13.5h-4.5a.5.5 0 0 0-.5.5v4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
      {props.children}
    </div>
  );
}
