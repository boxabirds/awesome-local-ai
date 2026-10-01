import type { useUndo } from './useUndo';

const ICON = { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const;

export function UndoButtons(props: ReturnType<typeof useUndo>) {
  return (
    <>
      <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!props.canUndo} onClick={props.undo}>
        <svg {...ICON}>
          <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
        </svg>
      </button>
      <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!props.canRedo} onClick={props.redo}>
        <svg {...ICON}>
          <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />
        </svg>
      </button>
    </>
  );
}
