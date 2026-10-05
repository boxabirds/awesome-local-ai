/**
 * The board's own toolbar: the two tools the pointer can be, and the way to make a note.
 *
 * Story 2 had one tool, so this was a narrow strip on the left edge with one button in it (the design's
 * "toolbar strip, left side"). Story 9 adds a second thing the pointer can be — a place to put text — and
 * the strip's rules do not change: everything in it must be nameable and clickable without knowing what the
 * icon means, so every button carries an accessible name and a tooltip that also says the shortcut.
 *
 * The two tools are drawn as a pair, and read as one, because they are one question with two answers: *what
 * is a click on the board for?* Marking the active one with `aria-pressed` is what makes the answer
 * discoverable without pressing anything — a person who cannot see the cursor is otherwise left to press
 * each button and find out by watching what the next click does. `V` and `T` are the same question from the
 * keyboard, which is why the shortcut is part of the accessible name rather than a hint only readers get.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from '../../shared/config';
import type { BoardTool } from '../board/useTool';
import { UndoButtons } from '../board/UndoButtons';
import type { UndoButtonsProps } from '../board/UndoButtons';

/** What the PRD asks the tooltip to say, shortcut included. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note (N) — or double-click the board';

/** The same for the two tools, in the same shape: what it does, and the key that does it. */
export const SELECT_TOOLTIP = 'Select — move and resize what is there (V)';
export const TEXT_TOOLTIP = 'Text — click the board to write (T)';

export interface ToolbarProps {
  /** Add a note at the centre of the visible board and start typing. */
  onCreateSticky(): void;
  /**
   * Which tool the pointer is in, which is what decides which of the two buttons reads as pressed.
   * Defaults to Select, because a toolbar drawn without a tool to report is a board that is not in any.
   */
  tool?: BoardTool;
  /** Choose Select. Left out, the button is not drawn: a control with no command behind it is a lie. */
  onSelectTool?(): void;
  /** Choose the text tool, so the next click on the board writes instead of moves. */
  onTextTool?(): void;
  /**
   * Take the buttons out of use: on a board that could not be loaded there is
   * nothing to add a note to, and a button that does nothing when pressed would be
   * a lie, so it says so instead (and `App` refuses the write anyway).
   *
   * It takes the text tool with it for the same reason: a cursor that promises to write on a board that
   * will not be written to is a worse promise than no cursor.
   */
  disabled?: boolean;
  /**
   * This person's undo history, as the buttons need it. Optional because the toolbar is drawn on boards
   * that have no history to show — a board that never opened has no document to have done anything to —
   * and a control that has nothing to report is left off rather than drawn lying.
   */
  undo?: UndoButtonsProps;
}

export function Toolbar({
  onCreateSticky,
  tool = 'select',
  onSelectTool,
  onTextTool,
  disabled = false,
  undo,
}: ToolbarProps): JSX.Element {
  /** A click on the toolbar is a command, not a board gesture. */
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div className="toolbar" data-testid="toolbar" role="toolbar" aria-label="Board tools" onPointerDown={stop}>
      {onSelectTool ? (
        <button
          type="button"
          className="toolbar__button"
          data-testid="tool-select"
          aria-label="Select (V)"
          title={SELECT_TOOLTIP}
          aria-pressed={tool === 'select'}
          onClick={onSelectTool}
        >
          {/* A cursor, drawn as a character: no icon font, no asset. */}
          <span className="toolbar__glyph" aria-hidden="true">
            ⇱
          </span>
          <span className="toolbar__label">Select</span>
        </button>
      ) : null}
      {onTextTool ? (
        <button
          type="button"
          className="toolbar__button"
          data-testid="tool-text"
          aria-label="Text (T)"
          title={disabled ? 'Text — unavailable until this board is loaded' : TEXT_TOOLTIP}
          aria-pressed={tool === 'text'}
          disabled={disabled}
          aria-disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onTextTool();
          }}
        >
          {/* The letter is the icon: a piece of text has no shape to draw. */}
          <span className="toolbar__glyph toolbar__glyph--text" aria-hidden="true">
            T
          </span>
          <span className="toolbar__label">Text</span>
        </button>
      ) : null}
      <button
        type="button"
        className="toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title={disabled ? 'Sticky note — unavailable until this board is loaded' : STICKY_NOTE_TOOLTIP}
        disabled={disabled}
        aria-disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onCreateSticky();
        }}
      >
        {/* A folded-corner note, drawn in CSS: no icon font, no asset. It wears
            the same colour a new note is born with. */}
        <span
          className="toolbar__note-icon"
          aria-hidden="true"
          style={{ backgroundColor: STICKY_COLORS[DEFAULT_STICKY_COLOR] }}
        />
        <span className="toolbar__label">Sticky note</span>
      </button>
      {/* Below the tools, as the PRD puts them: they are not tools, they are the way back. */}
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
