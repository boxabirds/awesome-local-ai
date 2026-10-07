import { useRef } from 'react';
import { useNativeStopPropagation } from './useNativeStopPropagation';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons';
import type { ToolState } from './useTool';

export interface ToolbarProps {
  /** Create a sticky note in the centre of the visible board area. */
  onCreateSticky(): void;
  /** False disables creation while the board cannot be edited (e.g. it failed to load). */
  disabled?: boolean;
  /** This tab's undo/redo state and actions (story 8); absent on boards without a history. */
  undo?: UndoButtonsProps;
  /**
   * The active tool (story 9). The tool buttons report it with `aria-pressed`, and the
   * Text tool is unavailable on a board that cannot be edited (PRD text.load_failed).
   */
  tool?: ToolState;
}

export const STICKY_BUTTON_LABEL = 'Sticky note (N)';
export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';
export const SELECT_BUTTON_LABEL = 'Select (V)';
export const TEXT_BUTTON_LABEL = 'Text (T)';

/**
 * Left-side vertical board toolbar: the tool the board is in, then the things a
 * person can put on the board. The Sticky note button is always available.
 */
export function Toolbar({ onCreateSticky, disabled = false, undo, tool }: ToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);
  const isText = tool?.tool === 'text';

  return (
    <div ref={ref} className="board-toolbar" data-testid="board-toolbar">
      <button
        type="button"
        className="tool-button"
        data-testid="tool-select"
        aria-label={SELECT_BUTTON_LABEL}
        title={`${SELECT_BUTTON_LABEL} – move and resize what is on the board`}
        aria-pressed={tool ? tool.tool === 'select' : undefined}
        onClick={tool ? () => tool.setTool('select') : undefined}
      >
        <span className="tool-icon" aria-hidden="true">
          {'\u2196'}
        </span>
        Select
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="tool-text"
        aria-label={TEXT_BUTTON_LABEL}
        title={`${TEXT_BUTTON_LABEL} – write anywhere on the board`}
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool ? isText : undefined}
        onClick={disabled || !tool ? undefined : () => tool.setTool('text')}
      >
        <span className="tool-icon tool-icon-text" aria-hidden="true">
          T
        </span>
        Text
      </button>
      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label={STICKY_BUTTON_LABEL}
        title={STICKY_BUTTON_TOOLTIP}
        disabled={disabled}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onCreateSticky}
      >
        <span className="tool-icon" aria-hidden="true">
          {'\u{1F4CC}'}
        </span>
        Sticky note
      </button>
      {undo ? <UndoButtons {...undo} /> : null}
    </div>
  );
}
