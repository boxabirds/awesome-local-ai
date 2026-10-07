import type { JSX } from 'react';

import type { UndoButtonsProps } from './UndoButtons.js';
import { UndoButtons } from './UndoButtons.js';
import type { Tool } from './useTool.js';

/** Exact tooltip of the Sticky note button (PRD "Structure"). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

/**
 * What the same button says when the board will not take content. The tooltip is
 * where the reason goes: the button is the thing the user just tried to use, and
 * a control that will not respond has to say why where the pointer already is.
 */
export const BOARD_LOCKED_TOOLTIP = 'Sticky note \u2013 this board could not be loaded';

export interface ToolbarProps {
  /** Create a sticky note in the middle of what the user is looking at. */
  onCreateSticky(): void;
  /**
   * The active tool, and the way to change it (story 9). Both optional, and the
   * two tool buttons are drawn only when they are given: a board that was built
   * before there were tools - and there is one, story 2's component test - draws
   * the toolbar it always drew rather than a Select button it cannot press.
   */
  tool?: Tool;
  /** Make a tool the active one ('Select' and 'Text' buttons, and the shortcuts).
   * Omitted together with `tool` by a board with no tools. */
  onTool?: (tool: Tool) => void;
  /**
   * False while the board will not accept new content (a board the room could not
   * load - see `canEdit`). The button is then shown disabled rather than hidden:
   * the tool is still there, and what is missing is the board's ability to take
   * it, which is a fact about the board and not about the toolbar.
   */
  canEdit?: boolean;
  /**
   * This person's own undo/redo state (story 8), which is why these two buttons
   * can be greyed out on a board that is full of changes: everything a colleague
   * did is in the document and in none of this tab's history. Omitted by a board
   * that keeps no history at all, which renders neither button.
   */
  undo?: UndoButtonsProps;
}

/**
 * The left-side vertical toolbar. Story 2 contributes the Sticky note button;
 * later stories add their tools here.
 */
export function Toolbar({ onCreateSticky, tool, onTool, canEdit = true, undo }: ToolbarProps): JSX.Element {
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      // The toolbar is page chrome: a click or wheel over it must not reach the
      // board (which would pan, zoom or clear the selection).
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {onTool ? (
        <>
          {/* The two tools of this build, as a pressed/unpressed pair. `tool` is
              this tab's own pointer mode - it is not board content, and a
              colleague changing theirs changes nothing here - so `aria-pressed`
              is what says which one the person is in. The Text tool is greyed out
              with everything else that writes, because a click in Text mode puts
              an object on the board. */}
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="select-tool-button"
            aria-label="Select (V)"
            title="Select, move and resize (V)"
            aria-pressed={tool === 'select' ? 'true' : 'false'}
            onClick={() => onTool('select')}
          >
            <span className="board-toolbar-icon" aria-hidden="true">
              &#8598;
            </span>
            <span className="board-toolbar-label">Select</span>
          </button>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="text-tool-button"
            aria-label="Text (T)"
            title="Write text anywhere on the board (T)"
            aria-pressed={tool === 'text' ? 'true' : 'false'}
            disabled={!canEdit}
            onClick={() => onTool('text')}
          >
            <span className="board-toolbar-icon" aria-hidden="true">
              T
            </span>
            <span className="board-toolbar-label">Text</span>
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky-button"
        aria-label="Sticky note"
        title={canEdit ? STICKY_BUTTON_TOOLTIP : BOARD_LOCKED_TOOLTIP}
        disabled={!canEdit}
        onClick={onCreateSticky}
      >
        <span className="board-toolbar-icon" aria-hidden="true">
          &#9635;
        </span>
        {/* The shortcut in the label, because this is the button whose key is not
            on it: the story added `N` to the board and the label is where a
            person looks for it. The accessible name stays "Sticky note" - the
            tooltip carries the same sentence. */}
        <span className="board-toolbar-label">Sticky note (N)</span>
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
