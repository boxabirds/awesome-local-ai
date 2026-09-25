/**
 * Fixed left-side toolbar: the Select (V) and Text (T) tools with their pressed state
 * (anchor: text.tool_ui), the Sticky note button (anchor: sticky.toolbar) and, below the
 * tools, the Undo and Redo buttons (anchor: undo.buttons).
 */
import type { PointerEvent, WheelEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';
import type { Tool } from './useTool';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited: Sticky note and Text are disabled. */
  disabled?: boolean;
  undo?: UndoApi;
  /** Active tool; the tool buttons are shown when `onTool` is given. */
  tool?: Tool;
  onTool?(t: Tool): void;
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const tool = props.tool ?? 'select';
  const onTool = props.onTool;
  // The toolbar is not board space: pointer and wheel input here never reach the board.
  const stop = (e: PointerEvent | WheelEvent) => e.stopPropagation();
  return (
    <div
      className="board-toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      data-testid="board-toolbar"
      onPointerDown={stop}
      onWheel={stop}
    >
      {onTool !== undefined && (
        <>
          <button
            type="button"
            aria-label="Select (V)"
            title="Select (V)"
            aria-pressed={tool === 'select'}
            onClick={() => onTool('select')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path
                d="M6 3l12 9-5.5 1 3 6.5-2.5 1.2-3-6.5L6 18z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Text (T)"
            title="Text (T)"
            aria-pressed={tool === 'text'}
            disabled={props.disabled === true}
            onClick={() => onTool('text')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled === true}
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path
            d="M4 4h16v10l-6 6H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      {props.undo !== undefined && <UndoButtons {...props.undo} />}
    </div>
  );
}
