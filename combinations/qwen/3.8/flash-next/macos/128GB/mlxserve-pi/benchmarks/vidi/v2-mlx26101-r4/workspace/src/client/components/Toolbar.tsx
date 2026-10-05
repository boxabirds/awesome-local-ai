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

import { DEFAULT_STICKY_COLOR, SHAPE_KINDS, STICKY_COLORS } from '../../shared/config';
import type { ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';
import { UndoButtons } from '../board/UndoButtons';
import type { UndoButtonsProps } from '../board/UndoButtons';

/** What the PRD asks the tooltip to say, shortcut included. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note (N) — or double-click the board';

/** The same for the tools, in the same shape: what it does, and the key that does it. */
export const SELECT_TOOLTIP = 'Select — move and resize what is there (V)';
export const TEXT_TOOLTIP = 'Text — click the board to write (T)';
export const SHAPE_TOOLTIP = 'Shape — drag a rectangle, ellipse or diamond (S)';
export const CONNECTOR_TOOLTIP = 'Connector — drag an arrow between two objects (L)';

/** What the three kinds are called in the Shape menu, in the order they are offered. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface ToolbarProps {
  /** Add a note at the centre of the visible board and start typing. */
  onCreateSticky(): void;
  /**
   * Which tool the pointer is in, which is what decides which of the buttons reads as pressed.
   * Defaults to Select, because a toolbar drawn without a tool to report is a board that is not in any.
   */
  tool?: ToolId;
  /** Choose Select. Left out, the button is not drawn: a control with no command behind it is a lie. */
  onSelectTool?(): void;
  /** Choose the text tool, so the next click on the board writes instead of moves. */
  onTextTool?(): void;
  /** Choose the Shape tool, so the next drag on the board draws a shape. */
  onShapeTool?(): void;
  /** Choose the Connector tool, so the next drag on the board draws an arrow. */
  onConnectorTool?(): void;
  /**
   * Which shape the Shape tool will draw.
   *
   * The menu is shown only while the Shape tool is armed, because it is a decision about what to draw next
   * and there is nothing else it could be a decision about — a kind chosen while the arrow tool is up would
   * be a change to something nobody can see.
   */
  shapeKind?: ShapeKind;
  /** Choose the kind. Left out, no menu is drawn. */
  onShapeKind?(kind: ShapeKind): void;
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
  onShapeTool,
  onConnectorTool,
  shapeKind = 'rect',
  onShapeKind,
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
      {onShapeTool ? (
        <button
          type="button"
          className="toolbar__button"
          data-testid="tool-shape"
          aria-label="Shape (S)"
          title={disabled ? 'Shape — unavailable until this board is loaded' : SHAPE_TOOLTIP}
          aria-pressed={tool === 'shape'}
          disabled={disabled}
          aria-disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onShapeTool();
          }}
        >
          {/* A square with a diamond in front of it: the two shapes that need no words. */}
          <span className="toolbar__glyph toolbar__glyph--shape" aria-hidden="true">
            ◇
          </span>
          <span className="toolbar__label">Shape</span>
        </button>
      ) : null}
      {/* Which of the three the Shape tool will draw. A `select` and not three buttons, because they are one
          choice with three answers and only one of them can be right at a time — and because a menu is the
          one control that says what the alternatives are without making anybody press each of them to find
          out. It appears with the tool it belongs to, and disappears with it. */}
      {onShapeKind && tool === 'shape' ? (
        <label className="toolbar__kind" data-testid="shape-kind-field">
          <span className="toolbar__kind-label">Shape kind</span>
          <select
            className="toolbar__kind-select"
            data-testid="shape-kind"
            aria-label="Shape kind"
            value={shapeKind}
            disabled={disabled}
            onChange={(event) => {
              onShapeKind(event.currentTarget.value as ShapeKind);
            }}
          >
            {SHAPE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {SHAPE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {onConnectorTool ? (
        <button
          type="button"
          className="toolbar__button"
          data-testid="tool-connector"
          aria-label="Connector (L)"
          title={disabled ? 'Connector — unavailable until this board is loaded' : CONNECTOR_TOOLTIP}
          aria-pressed={tool === 'connector'}
          disabled={disabled}
          aria-disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onConnectorTool();
          }}
        >
          {/* An arrow between two dots, drawn as a character: no icon font, no asset. */}
          <span className="toolbar__glyph toolbar__glyph--connector" aria-hidden="true">
            ↝
          </span>
          <span className="toolbar__label">Connector</span>
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
