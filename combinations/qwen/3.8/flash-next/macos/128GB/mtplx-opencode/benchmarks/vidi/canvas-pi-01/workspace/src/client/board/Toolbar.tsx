/**
 * Story 2 · task 6 — the left tool palette (design "Toolbars: create, colour,
 * delete"). Story 8 · task 5 adds the Undo / Redo buttons; story 9 · task 6 adds
 * the two tool-mode buttons (Select / Text).
 *
 * A fixed vertical strip on the left of the board. The two tool buttons switch
 * the board's per-client tool mode (Select or Text); the Text tool is really
 * `disabled` on a read-only board. Clicking the sticky-note create tool makes a
 * note at the centre of the visible board (the parent owns the camera); the
 * history buttons undo / redo *this person's* own steps and sit disabled while
 * the personal stack is empty (PRD undo.empty). Pointer events are stopped so a
 * click never reaches the board surface underneath.
 */
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * True while the board is read-only (story 4: the connection reports
   * `load_failed`). The buttons are really `disabled`, so they are skipped by
   * keyboard and reported as such to assistive tech, not just inert.
   */
  disabled?: boolean;
  /** The active tool (story 9). Drives the `aria-pressed` state. */
  tool?: Tool;
  /** Switch the tool (Select / Text). */
  onSelectTool?(tool: Tool): void;
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

export function Toolbar({
  onCreateSticky,
  disabled = false,
  tool = 'select',
  onSelectTool,
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