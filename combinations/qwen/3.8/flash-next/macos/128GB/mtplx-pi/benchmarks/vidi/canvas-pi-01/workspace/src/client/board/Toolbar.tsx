/**
 * Story 2 · task 6 — the left tool palette (design "Toolbars: create, colour,
 * delete"). Story 8 · task 5 adds the Undo / Redo buttons; story 9 · task 6 adds
 * the two tool-mode buttons (Select / Text); story 10 · task 11 adds the Shape
 * button (with its kind menu) and the Connector button.
 *
 * A fixed vertical strip on the left of the board. The tool buttons switch the
 * board's per-client tool mode; the creating tools are genuinely `disabled` on a
 * read-only board. Clicking the sticky-note create tool makes a note at the
 * centre of the visible board (the parent owns the camera); the history buttons
 * undo / redo *this person's* own steps and sit disabled while the personal stack
 * is empty (PRD undo.empty). Pointer events are stopped so a click never reaches
 * the board surface underneath.
 *
 * Story 11 · task 17: the Pen button carries the ink / width row, which is shown
 * beside it for as long as the Pen tool is active — six colours and three widths,
 * always reachable without a second gesture (PRD pen.options, Structure: "Pen
 * toolbar (visible while Pen is active)"). Picking one applies to the *next*
 * strokes and never repaints what is already on the board.
 */
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import { SHAPE_KINDS } from '../../shared/config';
import type { Tool } from './useTool';
import type { ShapeKind } from '../../shared/objects/shape';
import { PenToolbar } from '../objects/PenToolbar';
import type { PenColor, PenThickness } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * Story 12 · open the image file picker (the Image button and the `I` shortcut).
   * A one-shot action, so this button never reads as pressed.
   */
  onAddImages?(): void;
  /**
   * True while the board is read-only (story 4: the connection reports
   * `load_failed`). The buttons are really `disabled`, so they are skipped by
   * keyboard and reported as such to assistive tech, not just inert.
   */
  disabled?: boolean;
  /** The active tool (story 9). Drives the `aria-pressed` state. */
  tool?: Tool;
  /** Switch the tool (Select / Text / Shape / Connector). */
  onSelectTool?(tool: Tool): void;
  /** The kind the Shape tool will draw (story 10, persistent across drags). */
  shapeKind?: ShapeKind;
  /** Choose the kind from the Shape menu. */
  onSelectShapeKind?(kind: ShapeKind): void;
  /** This tab's pen ink and width (story 11), shown while the Pen tool is active. */
  pen?: { color: string; thickness: string; onColor(color: PenColor): void; onThickness(t: PenThickness): void };
  /** Personal-history state for the Undo / Redo buttons (story 8). */
  history?: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo(): void;
    onRedo(): void;
  };
}

/** Exact PRD tooltip / accessible description for the sticky-note button. */
export const STICKY_BUTTON_TITLE = 'Sticky note \u2013 or double-click the board';

/** The kind menu's accessible names, in `SHAPE_KINDS` order. */
export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export function Toolbar({
  onCreateSticky,
  onAddImages,
  disabled = false,
  tool = 'select',
  onSelectTool,
  shapeKind = 'rect',
  onSelectShapeKind,
  pen,
  history,
}: ToolbarProps) {
  const stop = (event: ReactPointerEvent | MouseEvent) => {
    event.stopPropagation();
  };

  const pickTool = (event: MouseEvent, next: Tool) => {
    stop(event);
    if (disabled) return;
    onSelectTool?.(next);
  };

  const shapeActive = tool === 'shape';

  return (
    <div
      className="left-toolbar"
      data-testid="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
    >
      <button
        type="button"
        className="tool-button"
        data-testid="tool-select"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        onPointerDown={stop}
        onClick={(event) => pickTool(event, 'select')}
      >
        <span aria-hidden="true">{'\u{1F5B1}\uFE0F'}</span>
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="tool-text"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        // The Text tool is genuinely unavailable on a read-only board.
        disabled={disabled}
        onPointerDown={stop}
        onClick={(event) => pickTool(event, 'text')}
      >
        <span aria-hidden="true">T</span>
      </button>

      {/* Story 10 · Shape. Active state is pressed; the kind menu appears beside
          it while the tool is active (PRD `shape.create_drag`). */}
      <div className="tool-with-menu" data-testid="tool-shape-wrap">
        <button
          type="button"
          className="tool-button"
          data-testid="tool-shape"
          aria-label="Shape (S)"
          aria-pressed={shapeActive}
          aria-expanded={shapeActive}
          disabled={disabled}
          onPointerDown={stop}
          onClick={(event) => pickTool(event, 'shape')}
        >
          <span aria-hidden="true">{'\u25A6'}</span>
        </button>
        {shapeActive ? (
          <div
            className="shape-kind-menu"
            data-testid="shape-kind-menu"
            role="group"
            aria-label="Shape kind"
            onPointerDown={stop}
          >
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="shape-kind-button"
                data-testid={`shape-kind-${kind}`}
                aria-label={SHAPE_KIND_NAMES[kind]}
                aria-pressed={shapeKind === kind}
                onPointerDown={stop}
                onClick={(event) => {
                  stop(event);
                  onSelectShapeKind?.(kind);
                }}
              >
                {SHAPE_KIND_NAMES[kind]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="tool-button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        aria-pressed={tool === 'connector'}
        disabled={disabled}
        onPointerDown={stop}
        onClick={(event) => pickTool(event, 'connector')}
      >
        <span aria-hidden="true">{'\u2192'}</span>
      </button>

      {/* Story 11 · Pen. The ink / width row sits beside the button for as long as
          the Pen tool is active, and the same row reappears beside a single
          selected sketch, where it restyles that sketch (PRD pen.options). */}
      <div className="tool-with-menu" data-testid="tool-pen-wrap">
        <button
          type="button"
          className="tool-button"
          data-testid="tool-pen"
          aria-label="Pen (P)"
          aria-pressed={tool === 'pen'}
          disabled={disabled}
          onPointerDown={stop}
          onClick={(event) => pickTool(event, 'pen')}
        >
          <span aria-hidden="true">{'\u270E'}</span>
        </button>
        {tool === 'pen' && pen ? (
          <div className="pen-options-menu" data-testid="pen-options-menu" onPointerDown={stop}>
            <PenToolbar
              color={pen.color}
              thickness={pen.thickness}
              onColor={pen.onColor}
              onThickness={pen.onThickness}
            />
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="tool-button"
        data-testid="tool-image"
        aria-label="Add images"
        // A one-shot action, never a held mode: always `aria-pressed="false"`, so
        // it can never read as an active tool (PRD tools.non_persistent, TC-28).
        aria-pressed={false}
        disabled={disabled}
        onPointerDown={stop}
        onClick={(event) => {
          stop(event);
          if (disabled) return;
          onAddImages?.();
        }}
      >
        <span aria-hidden="true">{'\u{1F5BC}\uFE0F'}</span>
      </button>

      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TITLE}
        disabled={disabled}
        onPointerDown={stop}
        onClick={(event) => {
          stop(event);
          // Belt and braces: a disabled button never fires in a real browser,
          // but the handler is the thing that would change the document.
          if (disabled) return;
          onCreateSticky();
        }}
      >
        <span aria-hidden="true">{'\u{1F4DD}'}</span>
      </button>
      {history ? (
        <UndoButtons
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.onUndo}
          onRedo={history.onRedo}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
