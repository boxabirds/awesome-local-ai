import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { SHAPE_KINDS, SHAPE_KIND_LABELS, type ShapeKind } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { ToolId } from '../tools/useActiveTool';

/** What a tool is called on the screen, so the toolbar and the shortcut say one name. */
const TOOL_KEYS: Partial<Record<ToolId, string>> = {
  select: 'V',
  text: 'T',
  shape: 'S',
  connector: 'L',
  pen: 'P',
  image: 'I',
};

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
  tool?: ToolId;
  /** Put a tool up. The board decides whether it will take it; the toolbar only asks. */
  onTool?(tool: ToolId): void;
  /**
   * Which shape the Shape button will draw next. It is the toolbar's business because it is on the
   * toolbar that it is chosen, and the board's business nowhere else: the tool is told which shape
   * to make, and does not have an opinion of its own.
   */
  shapeKind?: ShapeKind;
  /** Choose the shape the Shape tool will draw. Asking for a kind also asks for the tool. */
  onShapeKind?(kind: ShapeKind): void;
  /**
   * Ask for the file picker, so a picture can be added (story 12).
   *
   * The toolbar does not know what happens to the file, and has no opinion: this button is the only tool on
   * the toolbar that is not a mode, so there is no `aria-pressed` to set and no tool name to remember -
   * pressing it asks a question, and the answer is a file. Left out, the button is not drawn at all, which
   * is the toolbar's way of saying that a button for something nobody wired up is a button people press twice.
   */
  onImage?(): void;
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
  shapeKind = 'rect',
  onShapeKind,
  onImage,
}: ToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  const choose = (next: ToolId): void => {
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
        className="toolbar__tool toolbar__tool--shape"
        data-testid="tool-shape"
        data-tool-name="shape"
        aria-label={`Shape (${TOOL_KEYS.shape ?? 'S'})`}
        title={`Shape \u2013 or press ${TOOL_KEYS.shape ?? 'S'}, then drag the board`}
        aria-pressed={tool === 'shape'}
        disabled={!canEdit}
        onClick={() => {
          choose('shape');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 5h16v14H4V5Zm1.5 1.5v11h13v-11h-13Z"
          />
        </svg>
        <span className="toolbar__label">Shape</span>
      </button>
      {tool === 'shape' ? (
        // The three kinds, shown under the button that draws one of them. They appear when the tool
        // is up rather than being permanently docked because a shape to draw is a question asked at
        // the moment of drawing, and the toolbar is 34 pixels wide: three icons always visible would
        // be three icons competing with the four tools for the same strip of screen.
        <span
          className="toolbar__kinds"
          data-testid="shape-kinds"
          role="group"
          aria-label="Shape kind"
        >
          {SHAPE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="toolbar__kind"
              data-testid={`shape-kind-${kind}`}
              data-kind={kind}
              aria-label={`${SHAPE_KIND_LABELS[kind]} shape`}
              title={`${SHAPE_KIND_LABELS[kind]} \u2013 the Shape tool will draw this`}
              aria-pressed={shapeKind === kind}
              disabled={!canEdit}
              onClick={() => {
                onShapeKind?.(kind);
              }}
            >
              <KindIcon kind={kind} />
            </button>
          ))}
        </span>
      ) : null}
      <button
        type="button"
        className="toolbar__tool toolbar__tool--connector"
        data-testid="tool-connector"
        data-tool-name="connector"
        aria-label={`Connector (${TOOL_KEYS.connector ?? 'L'})`}
        title={`Connector \u2013 or press ${TOOL_KEYS.connector ?? 'L'}, then drag from one thing to another`}
        aria-pressed={tool === 'connector'}
        disabled={!canEdit}
        onClick={() => {
          choose('connector');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M5 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm14 12a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-12.6-9.4 11.2 11.2-1.4 1.4L2 10l1.4-1.4Z"
          />
        </svg>
        <span className="toolbar__label">Connector</span>
      </button>
      <button
        type="button"
        className="toolbar__tool toolbar__tool--pen"
        data-testid="tool-pen"
        data-tool-name="pen"
        aria-label={`Pen (${TOOL_KEYS.pen ?? 'P'})`}
        title={`Pen \u2013 or press ${TOOL_KEYS.pen ?? 'P'}, then draw on the board`}
        aria-pressed={tool === 'pen'}
        disabled={!canEdit}
        onClick={() => {
          choose('pen');
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 19.1 5.1 15 15 5.1 18.9 9 9 18.9 4 19.1Zm12.2-15 1.4-1.4 3.7 3.7-1.4 1.4-3.7-3.7ZM3 21v-2l4.6-.6L3 19.4V21Z"
          />
        </svg>
        <span className="toolbar__label">Pen</span>
      </button>
      {onImage === undefined ? null : (
        // The one button on this toolbar that is not a tool: it does not change what a click on the board
        // means, it opens the person's file picker and gets out of the way. It sits with the tools because
        // it is how pictures get here, and it is disabled with them because a board that cannot be written
        // to has nowhere to put a picture - and unlike the others it must not look pressed, because it is
        // never up: the pressed state of a button that opens a dialog is the dialog.
        <button
          type="button"
          className="toolbar__tool toolbar__tool--image"
          data-testid="tool-image"
          data-tool-name="image"
          aria-label={`Add images (${TOOL_KEYS.image ?? 'I'})`}
          title={`Images \u2013 or press ${TOOL_KEYS.image ?? 'I'} \u2013 PNG, JPEG, GIF or WebP`}
          disabled={!canEdit}
          onClick={onImage}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M4 5h16v14H4V5Zm1.5 1.5v11h13v-11h-13ZM7 7.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2ZM6 17h12l-4.2-5.6-3 3.6-2-2.2L6 17Z"
            />
          </svg>
          <span className="toolbar__label">Image</span>
        </button>
      )}
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

/**
 * The three shapes, drawn small enough to fit on a toolbar button and different enough to tell apart
 * at that size: a box, a circle and a diamond.
 *
 * They are the same three figures as the shapes themselves, in the same SVG, at a third of the size -
 * which is the only reason a person can trust that pressing the round one will give them a round
 * thing. A stroke rather than a fill, because a filled blob of one colour at 18 pixels is three blobs
 * of one colour, and the outline is what carries the shape of a shape.
 */
export function KindIcon({ kind }: { kind: ShapeKind }): JSX.Element {
  const stroke = 'currentColor';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === 'ellipse' ? (
        <ellipse cx="12" cy="12" rx="8.5" ry="6.5" fill="none" stroke={stroke} strokeWidth="1.6" />
      ) : kind === 'diamond' ? (
        <polygon points="12,3 21,12 12,21 3,12" fill="none" stroke={stroke} strokeWidth="1.6" />
      ) : (
        <rect x="3.5" y="5.5" width="17" height="13" fill="none" stroke={stroke} strokeWidth="1.6" />
      )}
    </svg>
  );
}
