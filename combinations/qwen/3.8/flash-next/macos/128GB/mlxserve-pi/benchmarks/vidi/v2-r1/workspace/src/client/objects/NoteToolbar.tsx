import { type CSSProperties, type ReactNode } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** The colour name as it appears in the swatch's accessible name / tooltip. */
export const stickyColorLabel = (color: StickyColor): string =>
  color.charAt(0).toUpperCase() + color.slice(1);

const ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  backgroundColor: 'rgba(255, 255, 255, 0.96)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
  transformOrigin: 'left bottom',
};

const swatchStyle = (fill: string, active: boolean): CSSProperties => ({
  width: 18,
  height: 18,
  padding: 0,
  borderRadius: 4,
  border: active ? '2px solid #1f2328' : '1px solid rgba(0, 0, 0, 0.25)',
  backgroundColor: fill,
  cursor: 'pointer',
});

/**
 * Floating toolbar for the selected note: six colour swatches and a delete
 * (bin) button. Rendered in screen space (the parent counter-scales it so it
 * does not grow with zoom) and hidden while dragging or editing. Swatches and
 * the bin are real buttons with accessible names and tooltips.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): ReactNode {
  return (
    <div
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      style={barStyle}
      onPointerDown={(event) => {
        // Never start a note drag or clear the selection from the toolbar.
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {ORDER.map((name) => (
        <button
          key={name}
          type="button"
          data-testid={`swatch-${name}`}
          aria-label={`${stickyColorLabel(name)} colour`}
          aria-pressed={name === color}
          title={`${stickyColorLabel(name)} colour`}
          style={swatchStyle(STICKY_COLORS[name], name === color)}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        className="vidi6-icon-button"
        style={{ marginLeft: 2 }}
        onClick={onDelete}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
