import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/**
 * Floating toolbar above the selected note: six colour swatches + delete button.
 * Rendered in screen space (not scaled by zoom).
 */
export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const { color, onColor, onDelete } = props;

  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();
  const stopClick = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="note-toolbar"
      data-vidi6="note-toolbar"
      onPointerDown={stopPointer}
      onClick={stopClick}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className={`note-toolbar-swatch${color === c ? ' note-toolbar-swatch--active' : ''}`}
          aria-label={`${COLOR_NAMES[c]} colour`}
          aria-pressed={color === c}
          style={{ backgroundColor: STICKY_COLORS[c] }}
          onClick={() => onColor(c)}
          title={COLOR_NAMES[c]}
        />
      ))}
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete note"
        onClick={onDelete}
        title="Delete note"
      >
        🗑
      </button>
    </div>
  );
}
