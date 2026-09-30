interface UndoButtonsProps {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * Undo and Redo buttons for the left toolbar.
 * Disabled when the matching history is empty.
 * Tooltips show the keyboard shortcuts.
 */
export function UndoButtons({ canUndo, canRedo, undo, redo }: UndoButtonsProps) {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!canUndo}
        onClick={undo}
        style={{
          width: 36,
          height: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 6,
          background: canUndo ? '#fff' : '#E5E7EB',
          cursor: canUndo ? 'pointer' : 'not-allowed',
          boxShadow: canUndo ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
          opacity: canUndo ? 1 : 0.6,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M7 5L3 9l4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 9h8a4 4 0 0 1 0 8H9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!canRedo}
        onClick={redo}
        style={{
          width: 36,
          height: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 6,
          background: canRedo ? '#fff' : '#E5E7EB',
          cursor: canRedo ? 'pointer' : 'not-allowed',
          boxShadow: canRedo ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
          opacity: canRedo ? 1 : 0.6,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M11 5l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 9H7a4 4 0 0 0 0 8h2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
