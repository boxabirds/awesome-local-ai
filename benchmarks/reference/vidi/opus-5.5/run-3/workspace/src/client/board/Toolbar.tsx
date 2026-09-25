import type { SyntheticEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { useUndo } from './useUndo';
import type { Tool } from './useTool';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Fixed left-side toolbar: the Select and Text tools (story 9) when `tool` is given, the Sticky note button, then
 * Undo and Redo (story 8) when `undo` is given. The active tool's button is pressed.
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
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {props.tool && (
        <>
          <button
            type="button"
            className="toolbar__button"
            aria-label="Select (V)"
            title="Select (V)"
            aria-pressed={props.tool === 'select'}
            onClick={() => props.onTool?.('select')}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path
                d="M5 3l12 7.5-5.2 1.2L9.3 17z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar__button"
            aria-label="Text (T)"
            title="Text (T)"
            aria-pressed={props.tool === 'text'}
            disabled={props.disabled}
            onClick={() => props.onTool?.('text')}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <path
                d="M4.5 5.5V4h13v1.5M11 4v14M8 18h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      )}
      <button
        type="button"
        className="toolbar__button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 3h16v11l-5 5H3z" fill="#FFF59D" stroke="#1f2330" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M14 19v-5h5" fill="none" stroke="#1f2330" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {props.undo && (
        <>
          <div className="toolbar__divider" aria-hidden="true" />
          <UndoButtons {...props.undo} />
        </>
      )}
    </div>
  );
}
