import type { SyntheticEvent } from 'react';
import type { Tool } from './useTool';
import { UndoButtons } from './UndoButtons';
import type { useUndo } from './useUndo';

export const STICKY_BUTTON_LABEL = 'Sticky note (N)';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';
export const SELECT_TOOL_LABEL = 'Select (V)';
export const TEXT_TOOL_LABEL = 'Text (T)';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Fixed left-side toolbar: Select and Text tools (story 9) when `tool` is given, the Sticky note
 * button, then Undo and Redo (story 8) when `undo` is given.
 */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: ReturnType<typeof useUndo>;
  tool?: Tool;
  onTool?(t: Tool): void;
}) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      {props.tool && (
        <>
          <button
            type="button"
            className="toolbar-button"
            aria-label={SELECT_TOOL_LABEL}
            title={SELECT_TOOL_LABEL}
            aria-pressed={props.tool === 'select'}
            onClick={() => props.onTool?.('select')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 3l12 9-5.5 1 3 6.5-2.5 1.2-3-6.6L6 18z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-label={TEXT_TOOL_LABEL}
            title={TEXT_TOOL_LABEL}
            aria-pressed={props.tool === 'text'}
            disabled={props.disabled}
            onClick={() => props.onTool?.('text')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
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
        </>
      )}
      <button
        type="button"
        className="toolbar-button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 4h16v11l-5 5H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M20 15h-5v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {props.undo && <UndoButtons {...props.undo} />}
    </div>
  );
}
