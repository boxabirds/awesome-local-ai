import { UndoButtons } from './UndoButtons';
import type { UndoState } from './useUndo';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** Story 8: the undo/redo controls shown under the tools. */
  undo: UndoState;
  /** Story 9: the tool this page is holding, and the two buttons that pick it. */
  tool?: Tool;
  onTool?(tool: Tool): void;
  /**
   * True while this page must not be adding to the board — story 4 sets it when the
   * room could not load the board, because a note created on top of a board that
   * never arrived would be a note nobody else can see.
   */
  createDisabled?: boolean;
}

/** Exact tooltip shown on the Sticky note button (PRD wording). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';
/** Exact tooltip shown on the Select tool button. */
export const SELECT_TOOL_TOOLTIP = 'Select – or press V';
/** Exact tooltip shown on the Text tool button. */
export const TEXT_TOOL_TOOLTIP = 'Text – or press T, then click the board';

/**
 * The fixed left-side tool rail: which tool this page is holding (story 9), the
 * sticky note creation button (story 2) and the undo controls (story 8).
 *
 * The two tool buttons are a set: exactly one is pressed, and the Text button
 * carries `aria-disabled` *and* `disabled` semantics through `disabled`, because a
 * board that failed to load must not be given a tool that would write to it
 * (PRD text.not_editable).
 */
export function Toolbar({
  onCreateSticky,
  createDisabled = false,
  undo,
  tool = 'select',
  onTool,
}: ToolbarProps) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
  return (
    <div
      className="toolbar"
      data-testid="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <button
        type="button"
        className="toolbar__button"
        aria-label="Select (V)"
        title={SELECT_TOOL_TOOLTIP}
        data-testid="select-tool-button"
        aria-pressed={tool === 'select'}
        onClick={() => onTool?.('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M5 3l11 6-4.6 1.4L9 17 5 3Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Text (T)"
        title={TEXT_TOOL_TOOLTIP}
        data-testid="text-tool-button"
        aria-pressed={tool === 'text'}
        disabled={createDisabled}
        onClick={() => onTool?.('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 4h12v3h-1.6V6.6H11.3V14h1.9v1.6H6.8V14h1.9V6.6H5.6V7H4V4Z"
          />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar__button"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        data-testid="sticky-note-button"
        disabled={createDisabled}
        onClick={onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M4 3h9l4 4v10H4V3Zm8 0v5h5M6 9h8M6 12h8M6 15h5"
            stroke="currentColor"
            strokeWidth="1.3"
            fillOpacity="0.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
