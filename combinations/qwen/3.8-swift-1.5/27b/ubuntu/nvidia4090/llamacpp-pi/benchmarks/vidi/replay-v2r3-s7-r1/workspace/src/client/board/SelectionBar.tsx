import { NoteToolbar } from '../objects/NoteToolbar';
import type { StickySnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';

export interface SelectionBarProps {
  /** Number of selected objects. */
  count: number;
  /** The single selected sticky (enables the colour swatches), else null. */
  sticky: StickySnapshot | null;
  onColor: (c: StickyColor) => void;
  onDelete: () => void;
}

/**
 * Story 7: the floating bar for the current selection, rendered in screen
 * space above the selection's bounding box.
 * - 1 sticky selected → the NoteToolbar (colour swatches + delete).
 * - Anything else (1 non-sticky, 2+ of any mix) → "N selected" + Delete.
 * Pointer events stop propagation so the bar never clears the selection.
 */
export function SelectionBar({ count, sticky, onColor, onDelete }: SelectionBarProps): React.ReactElement {
  if (count === 1 && sticky) {
    return <NoteToolbar color={sticky.color} onColor={onColor} onDelete={onDelete} />;
  }
  return (
    <div
      data-testid="selection-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Selection options"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '6px 10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        color: '#222',
      }}
    >
      <span data-testid="selection-bar-count" aria-live="polite">
        {count} selected
      </span>
      <button
        type="button"
        data-testid="selection-bar-delete"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
        style={{
          height: 26,
          border: '1px solid rgba(0,0,0,0.2)',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 13,
          padding: '0 10px',
        }}
      >
        Delete
      </button>
    </div>
  );
}
