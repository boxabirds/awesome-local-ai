import type { ReactElement } from 'react';
import {
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';

/**
 * Story 7 (sel.interaction): the multi-selection bar. Shown when two or more
 * objects are selected: "N selected" plus a Delete button. Rendered in the
 * world layer just above the selection's bounding box.
 *
 * A single selected sticky shows its own NoteToolbar instead (rendered by the
 * note), so this bar returns null for a selection of size < 2.
 *
 * The count is announced to screen readers via an aria-live="polite" region.
 */
export function SelectionBar(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}): ReactElement | null {
  const { ids, snapshot, onDelete } = props;
  if (ids.size < 2) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;

  const BAR_H = 30;
  const GAP = 8;

  return (
    <div
      data-selection-bar="true"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y - BAR_H - GAP,
        height: BAR_H,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        background: '#ffffff',
        border: '1px solid #d5d9e0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span aria-live="polite" data-selection-count={ids.size} style={{ fontSize: 13, color: '#23272e' }}>
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
        style={{
          border: '1px solid #d5d9e0',
          borderRadius: 5,
          background: '#fff',
          color: '#b3261e',
          cursor: 'pointer',
          fontSize: 12,
          padding: '3px 8px',
        }}
      >
        Delete
      </button>
    </div>
  );
}
