import type { JSX } from 'react';
import type { UseUndoResult } from './useUndo';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

/**
 * Left-side vertical toolbar with tool buttons, Sticky note button, and Undo/Redo buttons.
 */
export function Toolbar(props: {
  tool: Tool;
  onToolChange(t: Tool): void;
  onCreateSticky(): void;
  disabled?: boolean;
  undoState?: UseUndoResult;
}): JSX.Element {
  return (
    <div className="toolbar" data-testid="toolbar">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Select (V)"
        title="Select tool – or press V"
        aria-pressed={props.tool === 'select'}
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onToolChange('select')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 2l12 9-5 1-2 5-5-15z" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Text (T)"
        title="Text tool – or press T"
        aria-pressed={props.tool === 'text'}
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onToolChange('text')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <text x="4" y="15" fontSize="14" fontFamily="sans-serif" fill="currentColor">T</text>
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-button"
        aria-label="Sticky note"
        title="Sticky note – or press N"
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="2" fill="#FFF59D" stroke="#c8cdd4" strokeWidth="1" />
          <line x1="5" y1="7" x2="15" y2="7" stroke="#8a8a5c" strokeWidth="1.5" />
          <line x1="5" y1="11" x2="12" y2="11" stroke="#8a8a5c" strokeWidth="1.5" />
        </svg>
      </button>
      {props.undoState && <UndoButtons {...props.undoState} />}
    </div>
  );
}
