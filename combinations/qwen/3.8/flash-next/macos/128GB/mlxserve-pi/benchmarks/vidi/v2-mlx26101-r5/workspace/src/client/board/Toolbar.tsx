import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { ToolId } from '../tools/useActiveTool';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';

/** Tooltip of the Sticky note button (exact product text). */
export const STICKY_BUTTON_HINT = 'Sticky note – or double-click the board';

/** Tooltip of the Select tool button (exact product text). */
export const SELECT_BUTTON_HINT = 'Select – or press V';

/** Tooltip of the Text tool button (exact product text). */
export const TEXT_BUTTON_HINT = 'Text – or press T';

/** Tooltip of the Shape tool button (exact product text). */
export const SHAPE_BUTTON_HINT = 'Shape – or press S';

/** Tooltip of the Connector tool button (exact product text). */
export const CONNECTOR_BUTTON_HINT = 'Connector – or press L';

/** Tooltip of the Pen tool button (exact product text). */
export const PEN_BUTTON_HINT = 'Pen – or press P';

/** What the Sticky note button says when the board cannot be written to. */
export const LOAD_FAILED_BUTTON_HINT = "This board couldn't be loaded, so it can't be changed";

/**
 * The three shapes, in the order they are offered, with the word on each button and the icon on it.
 *
 * Mapped over `SHAPE_KINDS`, because there is exactly one list of what a shape can be and this is a
 * rendering of it — a kind added to the model appears on the toolbar in its place, and a kind added to
 * this list without being added to that one would be a button that writes a shape nobody can read.
 */
const SHAPE_KIND_BUTTON_INFO: Readonly<Record<ShapeKind, { label: string; icon: string }>> = {
  rect: { label: 'Rectangle', icon: '▭' },
  ellipse: { label: 'Ellipse', icon: '◯' },
  diamond: { label: 'Diamond', icon: '◇' },
};

export const SHAPE_KIND_BUTTONS: ReadonlyArray<{ kind: ShapeKind; label: string; icon: string }> = SHAPE_KINDS.map(
  (kind) => ({ kind, ...SHAPE_KIND_BUTTON_INFO[kind] }),
);

export interface ToolbarProps {
  /** Creates a sticky note in the middle of the visible board area. */
  onCreateSticky(): void;
  /**
   * The tool the pointer is in, and the one way to change it.
   *
   * The pressed button is this tool: the toolbar is where a person looks to know what a click on empty
   * board will do, so the answer has to be on the screen and not in the keyboard they did not learn.
   * Left out altogether — a toolbar rendered by a story that has no tools — and no tool is drawn.
   *
   * One handler for every tool rather than one per tool, because a tool is a value and not a callback:
   * a board that had `onSelectTextTool`, `onSelectShapeTool` and whatever comes next would have a new
   * prop to add for every idea, and a toolbar that draws `SHAPE_KINDS` would be out of step with itself.
   */
  tool?: ToolId;
  onToolSelect?(tool: ToolId): void;
  /**
   * Which of the three shapes the Shape tool will draw.
   *
   * The tool's own setting, and the reason it is passed in rather than kept here is that the board owns
   * it: a toolbar that forgot it between renders would be a toolbar whose lit button moved when nobody
   * pressed it.
   */
  shapeKind?: ShapeKind;
  onShapeKindSelect?(kind: ShapeKind): void;
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
 * PRD's structure asks for them below the tools. Story 9 added the tools above it, and story 10 the
 * two more: Select, Text, Shape, Connector. They are not four more things to click but the answer to
 * what clicking anywhere else means — so they come first, and the pressed one is lit.
 *
 * The Shape button carries a second row underneath itself while it is the tool in use, because "which
 * shape" is a question that only means something once a shape is being drawn, and a permanent row of
 * three would be three buttons competing for a person who is trying to draw an arrow.
 *
 * The toolbar swallows pointer and wheel events, so clicking a tool never pans the board or clears
 * the selection.
 */
export function Toolbar({
  onCreateSticky,
  canCreate = true,
  tool,
  onToolSelect,
  shapeKind,
  onShapeKindSelect,
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
      {onToolSelect !== undefined ? (
        <>
          <button
            aria-label="Select (V)"
            aria-pressed={tool === 'select'}
            className="toolbar-button"
            data-testid="tool-select"
            title={SELECT_BUTTON_HINT}
            type="button"
            onClick={() => onToolSelect('select')}
          >
            <span aria-hidden="true" className="toolbar-icon">
              {'🖐'}
            </span>
            <span className="toolbar-label">Select</span>
          </button>
          <button
            // The writing tools are the ones a board that cannot be loaded cannot offer: a click with
            // any of them would promise an object that can never be written, so they say they are
            // unavailable instead, in the same words the Sticky note button uses for the same reason.
            aria-disabled={canCreate ? undefined : 'true'}
            aria-label="Text (T)"
            aria-pressed={tool === 'text'}
            className="toolbar-button"
            data-testid="tool-text"
            disabled={!canCreate}
            title={canCreate ? TEXT_BUTTON_HINT : LOAD_FAILED_BUTTON_HINT}
            type="button"
            onClick={() => onToolSelect('text')}
          >
            <span aria-hidden="true" className="toolbar-icon">
              {'T'}
            </span>
            <span className="toolbar-label">Text</span>
          </button>
          <button
            aria-disabled={canCreate ? undefined : 'true'}
            aria-label="Shape (S)"
            aria-pressed={tool === 'shape'}
            className="toolbar-button"
            data-testid="tool-shape"
            disabled={!canCreate}
            title={canCreate ? SHAPE_BUTTON_HINT : LOAD_FAILED_BUTTON_HINT}
            type="button"
            onClick={() => onToolSelect('shape')}
          >
            <span aria-hidden="true" className="toolbar-icon">
              {'▭'}
            </span>
            <span className="toolbar-label">Shape</span>
          </button>
          {tool === 'shape' && onShapeKindSelect !== undefined ? (
            // Which shape, asked once the person has said they want one — and in the order the model
            // lists them, because this row is a rendering of that list and not a second copy of it.
            <div aria-label="Shape kinds" className="toolbar-shape-kinds" data-testid="toolbar-shape-kinds" role="group">
              {SHAPE_KIND_BUTTONS.map((entry) => (
                <button
                  aria-label={`${entry.label} shape`}
                  aria-pressed={shapeKind === entry.kind}
                  className="toolbar-button toolbar-button-kind"
                  data-testid={`shape-kind-${entry.kind}`}
                  disabled={!canCreate}
                  key={entry.kind}
                  title={entry.label}
                  type="button"
                  onClick={() => onShapeKindSelect(entry.kind)}
                >
                  <span aria-hidden="true" className="toolbar-icon">
                    {entry.icon}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <button
            aria-disabled={canCreate ? undefined : 'true'}
            aria-label="Connector (L)"
            aria-pressed={tool === 'connector'}
            className="toolbar-button"
            data-testid="tool-connector"
            disabled={!canCreate}
            title={canCreate ? CONNECTOR_BUTTON_HINT : LOAD_FAILED_BUTTON_HINT}
            type="button"
            onClick={() => onToolSelect('connector')}
          >
            <span aria-hidden="true" className="toolbar-icon">
              {'↗'}
            </span>
            <span className="toolbar-label">Connector</span>
          </button>
          <button
            // The pen is the fifth pointer and the first one that does not go away: the four above it make
            // one object and hand the pointer back to the arrow, and this one makes one object and stays,
            // because a person sketching draws several lines and does not want to reach for P between them.
            // It is why the lit state of this button matters more than the lit state of the others — it is
            // on for a whole drawing, and the pen's colour and thickness are beside it while it is.
            aria-disabled={canCreate ? undefined : 'true'}
            aria-label="Pen (P)"
            aria-pressed={tool === 'pen'}
            className="toolbar-button"
            data-testid="tool-pen"
            disabled={!canCreate}
            title={canCreate ? PEN_BUTTON_HINT : LOAD_FAILED_BUTTON_HINT}
            type="button"
            onClick={() => onToolSelect('pen')}
          >
            <span aria-hidden="true" className="toolbar-icon">
              {'✎'}
            </span>
            <span className="toolbar-label">Pen</span>
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
