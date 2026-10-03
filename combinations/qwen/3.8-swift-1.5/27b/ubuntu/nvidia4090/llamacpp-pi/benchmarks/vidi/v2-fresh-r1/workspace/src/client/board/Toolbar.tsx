// Left-side vertical toolbar with the Sticky note button and Undo/Redo.

import { useCallback, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { UndoButtons } from './UndoButtons';

interface ToolbarProps {
  onCreateSticky: () => void;
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function Toolbar({ onCreateSticky, disabled, canUndo, canRedo, onUndo, onRedo }: ToolbarProps) {
  const stopPointer = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
  }, []);
  const stopMouse = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      data-testid="toolbar"
      className="toolbar"
      style={{
        position: 'fixed',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        zIndex: 100,
      }}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onPointerMove={stopPointer}
      onDoubleClick={stopMouse}
    >
      <button
        type="button"
        aria-label="Sticky note"
        data-testid="sticky-note-btn"
        title="Sticky note – or double-click the board"
        onClick={onCreateSticky}
        disabled={disabled}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: '#FFF59D',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}
      >
        📝
      </button>
      <UndoButtons
        canUndo={canUndo ?? false}
        canRedo={canRedo ?? false}
        undo={onUndo ?? (() => {})}
        redo={onRedo ?? (() => {})}
      />
    </div>
  );
}
