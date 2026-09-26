import { type JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

/**
 * Floating toolbar above a selected sticky note: six colour swatches and a delete button.
 * Rendered in screen space (not scaled with zoom).
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  const colorNames = Object.keys(STICKY_COLORS) as StickyColor[];

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {colorNames.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${name.charAt(0).toUpperCase() + name.slice(1)} colour`}
          aria-pressed={color === name}
          data-testid={`color-${name}`}
          className="note-toolbar-swatch"
          style={{ backgroundColor: STICKY_COLORS[name] }}
          title={`${name.charAt(0).toUpperCase() + name.slice(1)} colour`}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        data-testid="delete-note"
        className="note-toolbar-delete"
        onClick={onDelete}
      >
        &#x1F5D1;
      </button>
    </div>
  );
}
