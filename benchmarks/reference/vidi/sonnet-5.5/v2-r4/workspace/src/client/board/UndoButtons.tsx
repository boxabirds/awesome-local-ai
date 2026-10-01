import type { useUndo } from './useUndo';

const buttonStyle = (disabled: boolean) =>
  ({ width: 40, height: 40, border: 'none', background: 'transparent', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }) as const;

const icon = { viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: '#444', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export function UndoButtons(props: ReturnType<typeof useUndo>) {
  return (
    <>
      <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!props.canUndo} onClick={props.undo} style={buttonStyle(!props.canUndo)}>
        <svg {...icon}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>
      </button>
      <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!props.canRedo} onClick={props.redo} style={buttonStyle(!props.canRedo)}>
        <svg {...icon}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></svg>
      </button>
    </>
  );
}
