import { STICKY_COLORS, type StickyColor } from '../../shared/config.ts';
import { useUndoBoundary } from '../board/useUndo.ts';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

function colorLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const SWATCH: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: '2px solid rgba(0,0,0,0.15)',
  cursor: 'pointer',
  padding: 0,
};

/**
 * Floating toolbar for the selected note, rendered in screen space (it does not
 * scale with zoom). Six colour swatches (distinguishable by name, not only by
 * colour) and a delete button. Stops pointer/wheel propagation so its clicks
 * never reach the viewport.
 */
export function NoteToolbar(props: NoteToolbarProps) {
  const stop = (
    e: React.PointerEvent | React.MouseEvent | React.WheelEvent,
  ) => e.stopPropagation();
  // Each click here is one command, so each one is fenced in: picking a second
  // colour two hundred milliseconds after the first is a second undo step, not an
  // extension of the first (undo.boundaries).
  const boundary = useUndoBoundary();
  const pick = (name: StickyColor) => {
    boundary();
    props.onColor(name);
    boundary();
  };
  const remove = () => {
    boundary();
    props.onDelete();
    boundary();
  };
  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note options"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 8,
        padding: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${colorLabel(name)} colour`}
          aria-pressed={props.color === name}
          title={`${colorLabel(name)} colour`}
          onClick={() => pick(name)}
          style={{
            ...SWATCH,
            background: STICKY_COLORS[name],
            outline: props.color === name ? '2px solid #2f6fed' : undefined,
            outlineOffset: 1,
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        onClick={remove}
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: '22px',
          color: '#b3261e',
        }}
      >
        <span aria-hidden>&#128465;</span>
      </button>
    </div>
  );
}
