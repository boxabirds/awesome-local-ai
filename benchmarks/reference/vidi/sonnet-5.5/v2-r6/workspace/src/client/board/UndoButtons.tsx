import type { useUndo } from './useUndo';

export function UndoButtons(props: ReturnType<typeof useUndo>) {
  return (
    <>
      <button
        type="button"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd+Z)"
        disabled={!props.canUndo}
        aria-disabled={!props.canUndo}
        onClick={props.undo}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 8h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!props.canRedo}
        aria-disabled={!props.canRedo}
        onClick={props.redo}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="m15 7 5 5-5 5M20 12H10a6 6 0 0 0 0 8h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );
}
