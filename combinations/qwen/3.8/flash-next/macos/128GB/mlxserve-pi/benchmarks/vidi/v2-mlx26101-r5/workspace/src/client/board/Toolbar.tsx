import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { Tool } from './useTool';

/** Tooltip of the Sticky note button (exact product text). */
export const STICKY_BUTTON_HINT = 'Sticky note – or double-click the board';

/** Tooltip of the Select tool button (exact product text). */
export const SELECT_BUTTON_HINT = 'Select – or press V';

/** Tooltip of the Text tool button (exact product text). */
export const TEXT_BUTTON_HINT = 'Text – or press T';

/** What the Sticky note button says when the board cannot be written to. */
export const LOAD_FAILED_BUTTON_HINT = "This board couldn't be loaded, so it can't be changed";

export interface ToolbarProps {
  /** Creates a sticky note in the middle of the visible board area. */
  onCreateSticky(): void;
  /**
   * The tool the pointer is in, and the two ways to change it.
   *
   * The pressed button is this tool: the toolbar is where a person looks to know what a click on empty
   * board will do, so the answer has to be on the screen and not in the keyboard they did not learn.
   * Left out altogether — a toolbar rendered by a story that has no tools — and neither button is drawn.
   */
  tool?: Tool;
  onSelectTool?(): void;
  onSelectTextTool?(): void;
  /**
   * False while the board cannot be written to (story 4: the room could not load it). The
   * button is disabled rather than hidden or quietly inert, so that it is still there to be
   * found and still says why nothing happens — `title` carries the reason.
   */
  canCreate?: boolean;
  /**
   * The undo history of the person using this board, already answered by `useUndo`: whether there is
   * anything of theirs to take back or put back, and the two things to ask for. Left out, the toolbar
   * offers no undo at all — which is what a board without a history controller looks like, rather than
   * a board whose buttons have been clicked to death.
   */
  undo?: UndoButtonsProps;
}

/**
 * The fixed left-side toolbar.
 *
 * Story 2 put the Sticky note button here; story 8 put Undo and Redo under it, because "what can I
 * still take back" is a question about the whole board rather than about one tool, and because the
 * PRD's structure asks for them below the tools. Story 9 added the two tools above it: Select and Text,
 * which are not two more things to click but the answer to what clicking anywhere else means — so they
 * come first, and the pressed one is lit.
 *
 * The toolbar swallows pointer and wheel events, so clicking a tool never pans the board or clears
 * the selection.
 */
export function Toolbar({
  onCreateSticky,
  canCreate = true,
  tool,
  onSelectTool,
  onSelectTextTool,
  undo,
}: ToolbarProps): React.JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement> | ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };
  return (
    <div
      aria-label="Board tools"
      className="board-toolbar"
      data-testid="board-toolbar"
      role="toolbar"
      aria-orientation="vertical"
      onClick={stop}
      onDoubleClick={stop}
      onPointerCancel={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      {onSelectTool !== undefined && onSelectTextTool !== undefined ? (
        <>
          <button
            aria-label="Select (V)"
            aria-pressed={tool === 'select'}
            className="toolbar-button"
            data-testid="tool-select"
            title={SELECT_BUTTON_HINT}
            type="button"
            onClick={onSelectTool}
          >
            <span aria-hidden="true" className="toolbar-icon">
              {'🖐'}
            </span>
            <span className="toolbar-label">Select</span>
          </button>
          <button
            // The writing tool is the one tool a board that cannot be loaded cannot offer: a click with
            // it would promise a text object that can never be written, so it says it is unavailable
            // instead, in the same words the Sticky note button uses for the same reason.
            aria-disabled={canCreate ? undefined : 'true'}
            aria-label="Text (T)"
            aria-pressed={tool === 'text'}
            className="toolbar-button"
            data-testid="tool-text"
            disabled={!canCreate}
            title={canCreate ? TEXT_BUTTON_HINT : LOAD_FAILED_BUTTON_HINT}
            type="button"
            onClick={onSelectTextTool}
          >
            <span aria-hidden="true" className="toolbar-icon">
              {'T'}
            </span>
            <span className="toolbar-label">Text</span>
          </button>
        </>
      ) : null}
      <button
        aria-disabled={canCreate ? undefined : 'true'}
        aria-label="Sticky note (N)"
        className="toolbar-button"
        data-testid="create-sticky"
        disabled={!canCreate}
        title={canCreate ? STICKY_BUTTON_HINT : LOAD_FAILED_BUTTON_HINT}
        type="button"
        onClick={onCreateSticky}
      >
        <span aria-hidden="true" className="toolbar-icon">
          {'🗒'}
        </span>
        <span className="toolbar-label">Sticky note</span>
      </button>
      {undo ? (
        // A rule between the tools and the history, so the two groups read as two groups.
        <div aria-hidden="true" className="toolbar-divider" data-testid="toolbar-divider" />
      ) : null}
      {undo ? <UndoButtons {...undo} unavailable={canCreate ? undefined : LOAD_FAILED_BUTTON_HINT} /> : null}
    </div>
  );
}
