import { UndoButtons } from './UndoButtons';
import type { UndoControls } from './useUndo';
import { SELECT_TOOL_LABEL, TEXT_TOOL_LABEL, type Tool } from './useTool';

export const STICKY_BUTTON_LABEL = 'Sticky note';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited (its saved state could not be loaded). */
  disabled?: boolean;
  /** Undo and Redo buttons below the tools (story 8); omitted when absent. */
  undo?: UndoControls;
  /** The active tool (story 9); Select when absent. */
  tool?: Tool;
  /** Chooses a tool; without it the Select and Text buttons are not shown. */
  onTool?(t: Tool): void;
}

/** Left-side vertical tool bar. */
export function Toolbar({ onCreateSticky, disabled = false, undo, tool = 'select', onTool }: ToolbarProps) {
  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {onTool && (
        <>
          <button
            type="button"
            className="toolbar__button"
            aria-label={SELECT_TOOL_LABEL}
            title={SELECT_TOOL_LABEL}
            aria-pressed={tool === 'select'}
            onClick={() => onTool('select')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 3l12 9-5.5 1 3 6.5-2.5 1.2-3-6.5L6 18z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar__button"
            aria-label={TEXT_TOOL_LABEL}
            title={TEXT_TOOL_LABEL}
            aria-pressed={tool === 'text'}
            disabled={disabled}
            onClick={() => onTool('text')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M5 6V4h14v2M12 4v16M9 20h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      )}
      <button
        type="button"
        className="toolbar__button"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        onClick={onCreateSticky}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 4h16v11l-5 5H4z"
            fill="#FFF59D"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M20 15h-5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
