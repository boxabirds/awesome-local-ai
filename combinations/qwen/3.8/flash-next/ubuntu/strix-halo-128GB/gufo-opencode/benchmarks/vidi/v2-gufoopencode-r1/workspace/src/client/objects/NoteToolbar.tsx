import type { CSSProperties, JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

function labelFor(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

const containerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: '100%',
  marginBottom: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  background: '#ffffff',
  border: '1px solid #d6dae1',
  borderRadius: 8,
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
  pointerEvents: 'auto',
  zIndex: 10,
  transformOrigin: 'bottom left',
  whiteSpace: 'nowrap'
};

const swatchStyle: CSSProperties = {
  width: 22,
  height: 22,
  padding: 0,
  border: '1px solid rgba(0, 0, 0, 0.2)',
  borderRadius: 4,
  cursor: 'pointer'
};

const deleteStyle: CSSProperties = {
  height: 22,
  minWidth: 26,
  padding: '0 4px',
  border: '1px solid #d6dae1',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1
};

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const stop = (event: { stopPropagation(): void }): void => {
    // Never let a toolbar click pan the board, clear the selection or start a
    // note drag.
    event.stopPropagation();
  };

  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      style={containerStyle}
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={labelFor(name)}
          title={labelFor(name)}
          aria-pressed={props.color === name}
          style={{ ...swatchStyle, background: STICKY_COLORS[name] }}
          onClick={() => props.onColor(name)}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title="Delete note"
        style={deleteStyle}
        onClick={() => props.onDelete()}
      >
        🗑
      </button>
    </div>
  );
}
