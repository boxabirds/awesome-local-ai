import { useCallback } from 'react';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { UndoState } from './useUndo';

/**
 * The fixed left toolbar (anchors `sticky.toolbar`, `undo.controls`,
 * `text.tool_ui`). Its tools are the two board tools - Select and Text - the
 * sticky note button, which creates a note at the centre of the visible board, and
 * the two buttons that take a person's own changes back and forward again.
 *
 * The tool buttons show which tool this client is holding (`aria-pressed`), and each
 * label names the keyboard shortcut that does the same thing: V, T, N. Text is
 * disabled on a board this client may not edit (TC-15).
 */
export interface ToolbarProps {
  onCreateSticky(): void;
  /** Story 9 (`text.tool_ui`): the tool this client is holding. */
  tool?: Tool;
  onSelectTool?(tool: Tool): void;
  /** True while the room could not load the board (`persist.client_status`). */
  disabled?: boolean;
  /** Undo and redo for this board (`undo.controls`). */
  undo?: UndoState;
}

export function Toolbar(props: ToolbarProps) {
  const { onCreateSticky, tool = 'select', onSelectTool, disabled = false, undo } = props;

  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const pickTool = (next: Tool): void => {
    if (disabled) {
      return;
    }
    onSelectTool?.(next);
  };

  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      data-board-chrome="true"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      <button
        type="button"
        className={`toolbar__button${tool === 'select' ? ' toolbar__button--active' : ''}`}
        data-testid="select-tool"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => pickTool('select')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M6 3l12 8-6 1.5L14 19l-2.5 1-2-6.5L6 17z" fill="currentColor" />
        </svg>
        <span className="toolbar__label">Select</span>
      </button>
      <button
        type="button"
        className={`toolbar__button${tool === 'text' ? ' toolbar__button--active' : ''}`}
        data-testid="text-tool"
        aria-label="Text (T)"
        title="Text (T) – then click the board where the text goes"
        disabled={disabled}
        aria-pressed={tool === 'text'}
        onClick={() => pickTool('text')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M5 5h14M12 5v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="toolbar__label">Text</span>
      </button>
      <button
        type="button"
        className="toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          onCreateSticky();
        }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="var(--sticky-icon, #FFF59D)" />
          <path d="M7 9h10M7 13h7" fill="none" stroke="#3d3d28" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="toolbar__label">Sticky note (N)</span>
      </button>
      {undo ? (
        <UndoButtons
          canUndo={undo.canUndo}
          canRedo={undo.canRedo}
          undo={undo.undo}
          redo={undo.redo}
        />
      ) : null}
    </div>
  );
}
