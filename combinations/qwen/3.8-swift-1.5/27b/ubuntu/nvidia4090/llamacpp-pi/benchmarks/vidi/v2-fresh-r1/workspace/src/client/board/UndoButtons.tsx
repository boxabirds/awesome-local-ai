// Undo and Redo buttons for the left toolbar.

interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        data-testid="undo-btn"
        title="Undo (Ctrl/Cmd+Z)"
        onClick={undo}
        disabled={!canUndo}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: '#f0f0f0',
          cursor: canUndo ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          opacity: canUndo ? 1 : 0.4,
        }}
      >
        ↩
      </button>
      <button
        type="button"
        aria-label="Redo"
        data-testid="redo-btn"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={redo}
        disabled={!canRedo}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          border: 'none',
          backgroundColor: '#f0f0f0',
          cursor: canRedo ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          opacity: canRedo ? 1 : 0.4,
        }}
      >
        ↪
      </button>
    </>
  );
}
