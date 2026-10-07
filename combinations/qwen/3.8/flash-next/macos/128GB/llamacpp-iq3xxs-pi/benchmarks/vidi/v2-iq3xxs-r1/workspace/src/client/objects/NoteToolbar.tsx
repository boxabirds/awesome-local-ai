import { useRef } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';
import { useNativeStopPropagation } from '../board/useNativeStopPropagation';

export interface NoteToolbarProps {
  readonly color: StickyColor;
  /** Disables every button while the board cannot be edited (it failed to load). */
  disabled?: boolean;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Accessible (and tooltip) names, so colour is not conveyed by colour alone. */
export const STICKY_COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * Floating toolbar for the selected note: six colour swatches and a delete (bin)
 * button. It is hidden while dragging or editing, and clicks on it never clear
 * the selection or pan the board.
 */
export function NoteToolbar({ color, disabled = false, onColor, onDelete }: NoteToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);

  return (
    <div ref={ref} className="note-toolbar" data-testid="note-toolbar" role="toolbar" aria-label="Note tools">
      {COLOR_NAMES.map((name) => {
        const label = `${STICKY_COLOR_LABELS[name]} colour`;
        return (
          <button
            key={name}
            type="button"
            className="note-swatch"
            data-testid={`color-${name}`}
            data-color-name={name}
            aria-label={label}
            aria-pressed={color === name}
            title={label}
            disabled={disabled}
            style={{ background: STICKY_COLORS[name] }}
            onClick={() => onColor(name)}
          />
        );
      })}
      <span className="note-toolbar-sep" aria-hidden="true" />
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        disabled={disabled}
        onClick={onDelete}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
