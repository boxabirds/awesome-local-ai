import { STICKY_COLORS } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { UndoControls } from './useUndo';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky: () => void;
  disabled?: boolean;
  /** Per-client undo/redo controls (story 8); rendered below the tools. */
  undo?: UndoControls;
  /** Story 9: active tool state. */
  tool?: Tool;
  onToolChange?: (t: Tool) => void;
}

/**
 * Fixed left-side toolbar. Holds tool buttons (Select, Text, Sticky note)
 * and, below them, the Undo/Redo buttons (story 8).
 * Pointer events stop propagation so clicks never reach the viewport.
 */
export function Toolbar({ onCreateSticky, disabled, undo, tool, onToolChange }: ToolbarProps): React.ReactElement {
  const selectActive = !tool || tool === 'select';
  const textActive = tool === 'text';
  const textDisabled = disabled;

  return (
    <div
      data-testid="toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid #d0d0d0',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        zIndex: 20,
      }}
    >
      {/* Select tool */}
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={selectActive}
        title="Select (V)"
        onClick={() => onToolChange?.('select')}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: selectActive ? '2px solid #1565C0' : '1px solid #cfcfcf',
          borderRadius: 8,
          background: selectActive ? '#E3F2FD' : '#fff',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span aria-hidden style={{ fontSize: 18 }}>↖</span>
      </button>

      {/* Text tool */}
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={textActive}
        title="Text (T)"
        onClick={() => onToolChange?.('text')}
        disabled={textDisabled}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: textActive ? '2px solid #1565C0' : '1px solid #cfcfcf',
          borderRadius: 8,
          background: textActive ? '#E3F2FD' : '#fff',
          cursor: textDisabled ? 'not-allowed' : 'pointer',
          padding: 0,
          opacity: textDisabled ? 0.5 : 1,
        }}
      >
        <span aria-hidden style={{ fontSize: 18, fontWeight: 'bold', fontFamily: 'serif' }}>T</span>
      </button>

      {/* Sticky note button */}
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: 40,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #cfcfcf',
          borderRadius: 8,
          background: disabled ? '#f5f5f5' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: 0,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            background: STICKY_COLORS.yellow,
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 3,
            display: 'block',
          }}
        />
      </button>

      {undo && <UndoButtons {...undo} />}
    </div>
  );
}
