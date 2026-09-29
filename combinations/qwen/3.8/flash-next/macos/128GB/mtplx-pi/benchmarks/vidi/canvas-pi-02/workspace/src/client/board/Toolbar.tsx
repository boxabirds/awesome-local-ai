import type { JSX } from 'react';
import { UndoButtons } from './UndoButtons';
import type { UndoState } from '../board/useUndo';
import type { Tool } from '../board/useTool';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/**
 * The fixed left toolbar.
 *
 * Story 9 added Select and Text tool buttons.
 * Story 10 adds Shape and Connector buttons.
 * Story 11 adds the Pen button, and the two option groups that appear with it:
 * the pen keeps its options on the toolbar, in the same place for the same
 * gesture every time, and they are session state — nothing here writes to the
 * document (`pen.options`).
 */

/** The pen's options, as the toolbar sees them. */
export interface PenOptionProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

const PEN_COLOR_NAMES = Object.keys(PEN_COLORS) as PenColor[];
const PEN_THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
export interface ToolbarProps {
  /** A new 200x200 sticky at the centre of the current viewport. */
  onCreateSticky(): void;
  /** The personal undo history's state, for the two buttons. */
  undo: UndoState;
  /** Active tool. */
  tool: Tool;
  /** Set the active tool. */
  onToolChange(tool: Tool): void;
  /** Whether editing is possible. */
  canEdit: boolean;
  /** Active tool id from useActiveTool. */
  activeTool?: string;
  /** Set tool via active tool hook. */
  onActiveToolChange?(t: string): void;
  /** Shape kind. */
  shapeKind?: string;
  /** The pen's colour and thickness, shown while the pen is the active tool. */
  pen?: PenOptionProps;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const { activeTool = 'select', onActiveToolChange } = props;
  return (
    <div
      className="board-toolbar"
      data-testid="board-toolbar"
      onPointerDown={(event) => {
        // UI chrome never reaches the board underneath.
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={activeTool === 'select'}
        title="Select – or press V"
        disabled={!props.canEdit && activeTool === 'select'}
        onClick={() => onActiveToolChange?.('select')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <path
            d="M4 2l10 8-5 1-2 5z"
            fill={activeTool === 'select' ? '#4285F4' : 'currentColor'}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={activeTool === 'text'}
        title="Text – or press T"
        disabled={!props.canEdit}
        onClick={() => onActiveToolChange?.('text')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <text
            x="4"
            y="14"
            fontSize="13"
            fontFamily="sans-serif"
            fill="currentColor"
            stroke="none"
          >
            T
          </text>
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-shape"
        aria-label="Shape (S)"
        aria-pressed={activeTool === 'shape'}
        title="Shape – or press S"
        disabled={!props.canEdit}
        onClick={() => onActiveToolChange?.('shape')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        aria-pressed={activeTool === 'connector'}
        title="Connector – or press L"
        disabled={!props.canEdit}
        onClick={() => onActiveToolChange?.('connector')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <line x1="3" y1="15" x2="15" y2="3" stroke="currentColor" strokeWidth="1.5" />
          <polygon points="15,3 12,5 13,7" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="tool-pen"
        aria-label="Pen (P)"
        aria-pressed={activeTool === 'pen'}
        title="Pen – or press P"
        disabled={!props.canEdit}
        onClick={() => onActiveToolChange?.('pen')}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <path
            d="M2.5 15.5c2-4 4.5-6 7-7.5 1.8-1 3-2.2 3.6-4l1.4 1.4c-.6 2.2-2 4-4 5.4-2 1.4-4.4 2.9-6.6 6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </button>
      {activeTool === 'pen' && props.pen ? (
        <div
          className="pen-options"
          data-testid="pen-options"
          role="group"
          aria-label="Pen options"
          onPointerDown={(event) => {
            // An option group is chrome: a press on it is never a press on the
            // board, and it must not start a stroke either.
            event.stopPropagation();
          }}
        >
          <span className="pen-options__group" role="group" aria-label="Pen colour" data-testid="pen-colours">
            {PEN_COLOR_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                className="pen-options__swatch"
                data-testid={`pen-color-${name}`}
                aria-label={`Pen colour ${name}`}
                aria-pressed={props.pen!.color === name}
                title={`${name[0]!.toUpperCase()}${name.slice(1)}`}
                style={{ background: PEN_COLORS[name] }}
                onClick={() => props.pen!.onColor(name)}
              />
            ))}
          </span>
          <span className="pen-options__group" role="group" aria-label="Pen thickness" data-testid="pen-thicknesses">
            {PEN_THICKNESS_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                className="pen-options__thickness"
                data-testid={`pen-thickness-${name}`}
                aria-label={`Pen thickness ${name}`}
                aria-pressed={props.pen!.thickness === name}
                title={`${name[0]!.toUpperCase()}${name.slice(1)}`}
                onClick={() => props.pen!.onThickness(name)}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
                  <line
                    x1="3"
                    y1="9"
                    x2="15"
                    y2="9"
                    stroke="currentColor"
                    strokeWidth={PEN_THICKNESS_WORLD[name]}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ))}
          </span>
        </div>
      ) : null}
      <button
        type="button"
        className="board-toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={props.onCreateSticky}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <rect
            x="2.5"
            y="2.5"
            width="13"
            height="13"
            rx="1"
            fill="#FFF3A3"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M5.5 6.5h7M5.5 9.5h7M5.5 12.5h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <UndoButtons {...props.undo} />
    </div>
  );
}