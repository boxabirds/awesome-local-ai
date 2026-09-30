/**
 * Story 8: Undo and Redo toolbar buttons.
 * Placed in the left toolbar below the tools.
 */
export function UndoButtons(props: {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}) {
  const { canUndo, canRedo, undo, redo } = props;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        aria-label="Undo"
        data-testid="undo-button"
        title="Undo (Ctrl/Cmd+Z)"
        onClick={undo}
        disabled={!canUndo}
        style={{
          width: 40,
          height: 40,
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 6,
          backgroundColor: canUndo ? '#fff' : '#e0e0e0',
          cursor: canUndo ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: canUndo ? 1 : 0.5,
        }}
      >
        ↩
      </button>
      <button
        aria-label="Redo"
        data-testid="redo-button"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        onClick={redo}
        disabled={!canRedo}
        style={{
          width: 40,
          height: 40,
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: 6,
          backgroundColor: canRedo ? '#fff' : '#e0e0e0',
          cursor: canRedo ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          opacity: canRedo ? 1 : 0.5,
        }}
      >
        ↪
      </button>
    </div>
  );
}
