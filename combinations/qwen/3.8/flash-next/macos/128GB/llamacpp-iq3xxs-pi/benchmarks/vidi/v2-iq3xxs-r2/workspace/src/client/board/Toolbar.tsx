import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoButtonState } from './useUndo';
import { DEFAULT_TOOL, type Tool } from './useTool';

/** Exact UI text (PRD: Left-side vertical toolbar with a "Sticky note" button). */
export const SELECT_TOOL_LABEL = 'Select (V)';
export const TEXT_TOOL_LABEL = 'Text (T)';
export const STICKY_BUTTON_LABEL = 'Sticky note (N)';
export const SELECT_TOOL_TOOLTIP = 'Select, move and resize – or press V';
export const TEXT_TOOL_TOOLTIP = 'Text – click the board to write – or press T';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  /** Creates a note in the middle of the visible board area and starts editing it. */
  onCreateSticky(): void;
  /** Story 9: which pointer mode the board is in, and the two buttons that change it. */
  tool?: Tool;
  onSelectTool?(): void;
  onTextTool?(): void;
  /** Story 4: while the board could not be loaded, the Sticky note button is disabled. */
  disabled?: boolean;
  /** Story 8: the undo controls under the Sticky note button; absent off a board. */
  undo?: UndoButtonState;
}

/**
 * The fixed left toolbar: the two pointer tools, the Sticky note button and the undo
 * controls. Its buttons are always available, whatever else is happening on the board.
 * Pointer events stop here so a click on a button never reaches the viewport (which would
 * pan the board and clear the selection).
 *
 * Story 5 moved sharing out of here and into the page that owns the board's address
 * (`share/SharePanel`): sharing is about the link, and the toolbar is about the board.
 *
 * Story 9 put the tools at the top, in the order the PRD gives them — Select, Text, Sticky
 * note — and gave the two pointer modes a pressed state, because a tool you cannot see is a
 * tool you press twice. The Sticky note button is not a tool and has no pressed state: it
 * creates one note where it can see, which is what it has always done.
 */
export function Toolbar({
  onCreateSticky,
  tool = DEFAULT_TOOL,
  onSelectTool,
  onTextTool,
  disabled = false,
  undo,
}: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="vidi6-toolbar"
      data-testid="toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="vidi6-toolbar-button vidi6-toolbar-tool"
        data-testid="tool-select"
        aria-label={SELECT_TOOL_LABEL}
        title={SELECT_TOOL_TOOLTIP}
        aria-pressed={tool === 'select'}
        onClick={onSelectTool}
      >
        <span className="vidi6-tool-glyph vidi6-tool-select" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{SELECT_TOOL_LABEL}</span>
      </button>
      {/* Selecting works on a board this client may not edit; a tool whose whole job is to
          put a thing on the board does not, so it is disabled along with the note button. */}
      <button
        type="button"
        className="vidi6-toolbar-button vidi6-toolbar-tool"
        data-testid="tool-text"
        aria-label={TEXT_TOOL_LABEL}
        title={TEXT_TOOL_TOOLTIP}
        aria-pressed={tool === 'text'}
        onClick={onTextTool}
        disabled={disabled}
      >
        <span className="vidi6-tool-glyph vidi6-tool-text" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{TEXT_TOOL_LABEL}</span>
      </button>
      <button
        type="button"
        className="vidi6-toolbar-button"
        data-testid="create-sticky"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <span className="vidi6-sticky-glyph" aria-hidden="true" />
        <span className="vidi6-toolbar-text">{STICKY_BUTTON_LABEL}</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
