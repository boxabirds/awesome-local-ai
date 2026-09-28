// Left board toolbar (stories 1, 9): tool buttons (Select/Text) + the sticky
// note button and undo/redo. The sticky note button is NOT a tool — it
// creates one sticky and keeps the current tool (story 9 keeps V/T/Escape as
// the only tool switches). The Text tool button is disabled on a non-
// editable board (text.not_editable).

import type { ReactElement } from 'react';
import type { Tool } from './useTool';
import { UndoButtons } from './UndoButtons';
import type { UndoApi } from './useUndo';

export interface ToolbarProps {
  /** The active board tool (story 9). */
  tool: Tool;
  /** Switches the active tool. */
  onTool(tool: Tool): void;
  /** Sticky note button: creates one note at the view centre. */
  onCreateSticky(): void;
  /** Non-editable board: the Text tool button is disabled (selection stays). */
  disabled?: boolean;
  /** Personal undo/redo (story 8); null while unavailable. */
  undo: UndoApi | null;
}

export function Toolbar(props: ToolbarProps): ReactElement {
  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      aria-label="Board tools"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="toolbar-tool"
        aria-label="Select (V)"
        title="Select – V"
        aria-pressed={props.tool === 'select'}
        onClick={() => props.onTool('select')}
      >
        {/* Cursor arrow. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 3l10 7-4.5.8L13 16l-2.4 1.2-2.4-5.2L5 15V3z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-tool"
        aria-label="Text (T)"
        title="Text – T"
        aria-pressed={props.tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onTool('text')}
      >
        {/* "T" glyph. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M4 4h12v3h-4.5v9h-3v-9H4V4z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-sticky"
        aria-label="Sticky note"
        title="Sticky note"
        disabled={props.disabled}
        onClick={() => props.onCreateSticky()}
      >
        {/* Sticky note square. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 3h12v9l-4 5H4V3z" fill="currentColor" />
        </svg>
      </button>
      {props.undo !== null && <UndoButtons {...props.undo} />}
    </div>
  );
}
