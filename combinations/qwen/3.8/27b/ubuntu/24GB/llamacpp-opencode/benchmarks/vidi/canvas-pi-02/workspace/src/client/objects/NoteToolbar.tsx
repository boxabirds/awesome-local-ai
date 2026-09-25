import type { JSX } from 'react';
import { STICKY_COLORS } from '../../shared/config';
import type { StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  /** The note's current colour (pressed swatch). */
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
  /** persist.client_status: disabled while the board is locked. */
  disabled?: boolean;
}

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * Floating toolbar for the selected note: six colour swatches (distinguishable
 * by name in both the tooltip and the accessible label, not only by colour)
 * and a delete (bin) button.
 */
export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  return (
    <div className="vidi6-note-toolbar" role="toolbar" aria-label="Note options">
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="vidi6-swatch"
          style={{ backgroundColor: STICKY_COLORS[name] }}
          aria-label={`${capitalize(name)} colour`}
          aria-pressed={name === props.color}
          title={capitalize(name)}
          disabled={props.disabled}
          onClick={() => props.onColor(name)}
        />
      ))}
      <button
        type="button"
        className="vidi6-delete"
        aria-label="Delete note"
        title="Delete note"
        disabled={props.disabled}
        onClick={props.onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.3a1 1 0 0 0 1 .95h4.6a1 1 0 0 0 1-.95L12 4M6.5 7v4M9.5 7v4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
