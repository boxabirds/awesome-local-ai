// Toolbar (story 2, sticky.toolbar contract; extended in story 9,
// tool.select / tool.text): the fixed left toolbar with the Select (V) and
// Text (T) tool buttons and the Sticky note (N) button.

import type { JSX } from 'react';
import type { Tool } from './useTool';

export interface ToolbarProps {
  /** The active tool (aria-pressed on the Select / Text buttons). */
  tool: Tool;
  onSelectTool(t: Tool): void;
  onCreateSticky(): void;
  /** Disable the tool buttons (story 4: board load failed). */
  disabled?: boolean;
  /** Rendered below the tools (story 8: the Undo/Redo buttons). */
  extra?: JSX.Element;
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { tool, onSelectTool, onCreateSticky, disabled = false, extra } = props;
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="toolbar__tool"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select (V)"
        onClick={() => onSelectTool('select')}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M5 3l11 6.5-4.6 1.3L13 16l-2.4 1-1.6-5.2L5 15V3z"
            fill="#3c4043"
            stroke="#202124"
            strokeWidth="0.75"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__tool"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text (T)"
        disabled={disabled}
        onClick={() => onSelectTool('text')}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M4 5V3h12v2M10 3v14m-3 0h6"
            stroke="#3c4043"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__sticky"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        onClick={onCreateSticky}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="14" height="14" rx="1.5" fill="#FFF59D" stroke="#b5a642" />
          <path d="M10 3v8h7" fill="#e8d873" stroke="#b5a642" strokeWidth="0.75" />
        </svg>
      </button>
      {extra}
    </div>
  );
}
