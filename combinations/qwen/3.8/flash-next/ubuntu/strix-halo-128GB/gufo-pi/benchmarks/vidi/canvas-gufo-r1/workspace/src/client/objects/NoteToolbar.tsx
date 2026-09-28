import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}

/**
 * Floating toolbar above a selected note with colour swatches and delete.
 * Rendered in screen space (not scaled by zoom), hidden while dragging/editing.
 */
export function NoteToolbar(props: NoteToolbarProps) {
  const { color, onColor, onDelete } = props;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
    >
      {(Object.entries(STICKY_COLORS) as [StickyColor, string][]).map(
        ([name, hex]) => (
          <button
            key={name}
            type="button"
            className="note-toolbar-swatch"
            aria-label={`${name} colour`}
            aria-pressed={color === name}
            style={{ backgroundColor: hex }}
            onClick={() => onColor(name)}
            title={`${name} colour`}
          />
        ),
      )}
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete note"
        onClick={onDelete}
        title="Delete note"
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
