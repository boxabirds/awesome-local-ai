import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';
import { UndoButtons } from './UndoButtons';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undoState?: UseUndoResult;
  tool?: Tool;
  onToolChange?(t: Tool): void;
}

/**
 * Fixed left-side toolbar with Select, Text and Sticky note buttons, plus undo/redo.
 */
export function Toolbar(props: ToolbarProps) {
  const { onCreateSticky, disabled, undoState, tool = 'select', onToolChange } = props;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="toolbar-left"
      data-testid="toolbar-left"
      onPointerDown={handlePointerDown}
    >
      {onToolChange && (
        <>
          <button
            type="button"
            aria-label="Select (V)"
            aria-pressed={tool === 'select'}
            title="Select tool"
            className={`toolbar-btn${tool === 'select' ? ' toolbar-btn-active' : ''}`}
            data-testid="select-tool-btn"
            onClick={() => onToolChange('select')}
          >
            <span className="toolbar-btn-icon" aria-hidden="true">
              {'\u2191'}
            </span>
            <span className="toolbar-btn-label">Select</span>
          </button>
          <button
            type="button"
            aria-label="Text (T)"
            aria-pressed={tool === 'text'}
            title="Text tool"
            className={`toolbar-btn${tool === 'text' ? ' toolbar-btn-active' : ''}`}
            data-testid="text-tool-btn"
            onClick={() => onToolChange('text')}
            disabled={disabled}
          >
            <span className="toolbar-btn-icon" aria-hidden="true">
              {'T'}
            </span>
            <span className="toolbar-btn-label">Text</span>
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Sticky note"
        title={`Sticky note \u2013 or double-click the board`}
        className="toolbar-btn"
        data-testid="create-sticky-btn"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <span className="toolbar-btn-icon" aria-hidden="true">
          {'\u25A1'}
        </span>
        <span className="toolbar-btn-label">Sticky note</span>
      </button>
      {undoState && <UndoButtons {...undoState} />}
    </div>
  );
}
