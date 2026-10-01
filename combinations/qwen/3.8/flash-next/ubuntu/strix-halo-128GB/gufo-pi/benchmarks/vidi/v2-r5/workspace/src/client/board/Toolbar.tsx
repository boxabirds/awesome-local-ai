import type React from 'react';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';
import { type ShapeKind } from '../../shared/config';

export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: UseUndoResult;
  tool?: Tool;
  onToolChange?(t: Tool): void;
  shapeKind?: ShapeKind;
  onShapeKindChange?(k: ShapeKind): void;
}

/** Tooltip and accessible name of the sticky note button, exactly as the PRD words it. */
export const STICKY_NOTE_TOOLTIP = 'Sticky note (N) – or double-click the board';

/**
 * Fixed left-side toolbar. Tool buttons (Select, Text) and the sticky note button.
 *
 * Pointer events stop at the toolbar so a click never reaches the viewport (which would pan the
 * board or clear the selection).
 */
export function Toolbar({ onCreateSticky, disabled, undo, tool, onToolChange }: ToolbarProps) {
  const stop = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
  };

  return (
    <div className="board-toolbar" data-testid="board-toolbar" role="toolbar" aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="board-toolbar-button"
        data-testid="create-sticky-button"
        aria-label="Sticky note (N)"
        title={STICKY_NOTE_TOOLTIP}
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M3 3h14v9.5L12.5 17H3V3Zm1.6 1.6v10.8h6.3v-3.9h3.9V4.6H4.6Z"
          />
        </svg>
      </button>
      {onToolChange && (
        <>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="tool-select-button"
            aria-label="Select (V)"
            title="Select (V)"
            aria-pressed={tool === 'select'}
            onClick={() => onToolChange('select')}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M4 2l12 9.5-5.5.9L14 18l-2.5 1-3.5-5.6L4 17V2z" />
            </svg>
          </button>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="tool-text-button"
            aria-label="Text (T)"
            title="Text (T)"
            aria-pressed={tool === 'text'}
            onClick={() => onToolChange('text')}
            disabled={disabled}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M3 4h14v3h-2V6h-4v9h2v2H7v-2h2V6H5v1H3V4z" />
            </svg>
          </button>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="tool-shape-button"
            aria-label="Shape (S)"
            title="Shape (S)"
            aria-pressed={tool === 'shape'}
            onClick={() => onToolChange('shape')}
            disabled={disabled}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <rect x="3" y="3" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <button
            type="button"
            className="board-toolbar-button"
            data-testid="tool-connector-button"
            aria-label="Connector (L)"
            title="Connector (L)"
            aria-pressed={tool === 'connector'}
            onClick={() => onToolChange('connector')}
            disabled={disabled}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13 3h4v4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </>
      )}
      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
