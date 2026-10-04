import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { Tool } from './useTool';

/** Shown when hovering the sticky note button (PRD "Add sticky notes", FR-2). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

export interface ToolbarProps {
  /** Add a sticky note in the middle of what the user is looking at. */
  onCreateSticky(): void;
  /**
   * False while the board could not be loaded. The button is disabled rather than quietly
   * doing nothing: a tool that looks available and then adds no note is the thing that makes
   * people press it twice. Left out, the tool is available, which is the normal case.
   */
  canEdit?: boolean;
  /**
   * This person's own undo history, shown under the tools. Left out, the toolbar offers no
   * undo - which is what a toolbar that is not standing in front of a board document shows.
   */
  undo?: UndoState;
  /**
   * Which tool is up, which is whose button says it is pressed. Left out, the board is in Select,
   * because a toolbar drawn on its own in front of nothing is pointing at things rather than
   * writing them.
   */
  tool?: Tool;
  /** Put a tool up. The board decides whether it will take it; the toolbar only asks. */
  onTool?(tool: Tool): void;
}

/**
 * The board's tools, docked at the top left. It is a `data-board-ui` element, so a press
 * on it never pans the board and a wheel over it never zooms - and it stays a fixed
 * screen-space control while the notes around it move.
 *
 * The first two buttons are the two things a press on the board can be for: pointing at things,
 * and writing on them. They are a pair of buttons that say which one is up rather than a single
 * toggle, because the two are not opposites - pressing the tool that is already up is how you say
 * "no, that one again" and it must not do nothing - and because the pressed state is the only place
 * a person can check what their mouse is about to do. Both carry their key in their name for the
 * same reason the sticky note's "(N)" is there: the shortcut is a thing on the screen, not a thing
 * in a manual.
 */
export function Toolbar({
  onCreateSticky,
  canEdit = true,
  undo,
  tool = 'select',
  onTool,
}: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  const choose = (next: Tool): void => {
    onTool?.(next);
  };
  return (
    <div
      className="toolbar"
      data-board-ui=""
      data-testid="board-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="toolbar__tool toolbar__tool--select"
        data-testid="tool-select"
        data-tool-name="select"
        aria-label="Select (V)"
        title="Select \u2013 or press V"
        aria-pressed={tool === 'select'}
        onClick={() => {
          choose('select');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M5 3l14 8-6 1.6L10.2 19 5 3Zm2.3 3.5 2.5 6.9 1.7-2.9 3.4-.9-7.6-3.1Z"
          />
        </svg>
        <span className="toolbar__label">Select</span>
      </button>
      <button
        type="button"
        className="toolbar__tool toolbar__tool--text"
        data-testid="tool-text"
        data-tool-name="text"
        aria-label="Text (T)"
        title="Text \u2013 or press T, then click the board"
        aria-pressed={tool === 'text'}
        disabled={!canEdit}
        onClick={() => {
          choose('text');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M5 4h14v4h-2V6h-4v12h2v2H9v-2h2V6H7v2H5V4Z" />
        </svg>
        <span className="toolbar__label">Text</span>
      </button>
      <button
        type="button"
        className="toolbar__sticky"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={!canEdit}
        onClick={onCreateSticky}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 4h10l6 6v10H4V4Zm1 1v14h11v-9h-5V5H5Zm6 1v4h4l-4-4Z"
          />
        </svg>
        <span className="toolbar__label">Sticky note</span>
      </button>
      {undo === undefined ? null : <UndoButtons {...undo} />}
    </div>
  );
}
