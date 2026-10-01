import type { useUndo } from './useUndo';

const ICON_PROPS = {
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true,
} as const;

export function UndoButtons(props: ReturnType<typeof useUndo>) {
  return (
    <>
      <button
        type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)"
        disabled={!props.canUndo} onClick={props.undo}
      >
        <svg {...ICON_PROPS}><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
      </button>
      <button
        type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)"
        disabled={!props.canRedo} onClick={props.redo}
      >
        <svg {...ICON_PROPS}><path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></svg>
      </button>
    </>
  );
}
