// Story 2: the fixed left-side board toolbar (anchor: sticky.toolbar) with
// the Sticky note button.
//
// Story 8: also hosts the Undo/Redo buttons (anchor: undo.buttons).
//
// Story 9: the Select (V) and Text (T) tool buttons join the Sticky note
// button (N); the active tool is highlighted (aria-pressed, text.tool_ui).

import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoBinding } from './useUndo';
import type { Tool } from './useTool';

export function Toolbar(
  props: {
    onCreateSticky: () => void;
    canEdit: boolean;
    tool: Tool;
    setTool(tool: Tool): void;
  } & UndoBinding,
): JSX.Element {
  const stop = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.stopPropagation();
  };
  return (
    <div
      className="board-toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
    >
      <button
        type="button"
        className="board-toolbar__tool"
        title="Select – V"
        aria-label="Select (V)"
        aria-pressed={props.tool === 'select'}
        onClick={() => props.setTool('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M5 3l10 6.5-4.5 1.2 2.6 5.1-2.3 1.2-2.6-5.1L5 15V3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__tool"
        title={props.canEdit ? 'Text – T' : 'Board unavailable'}
        aria-label="Text (T)"
        aria-pressed={props.tool === 'text'}
        disabled={!props.canEdit}
        onClick={() => props.setTool('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 5V3h12v2M10 3v14M7 17h6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__sticky"
        title={props.canEdit ? 'Sticky note – N' : 'Board unavailable'}
        aria-label="Sticky note"
        aria-disabled={props.canEdit ? undefined : true}
        disabled={!props.canEdit}
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3 3h14v9l-5 5H3V3zm10 11.5V15h3.5L13 14.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      <UndoButtons {...props} />
    </div>
  );
}
