/**
 * SelectionBar: shows "N selected" + Delete button when 2+ objects are selected.
 * When exactly one sticky is selected, NoteToolbar is shown (handled in StickyNote).
 */
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onDelete(): void;
}

export function SelectionBar({
  ids,
  snapshot,
  camera,
  onDelete,
}: SelectionBarProps): React.JSX.Element | null {
  if (ids.size < 2) return null;

  const selectedObjects = snapshot.filter((o) => ids.has(o.id));
  if (selectedObjects.length === 0) return null;

  const rects = selectedObjects.map(objectBounds);
  const bbox = unionRects(rects);
  if (!bbox) return null;

  // Position above the bounding box, centered horizontally (screen space)
  const topLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y - 32,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: 'var(--chrome-bg)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 6,
        boxShadow: '0 1px 3px rgb(0 0 0 / 12%)',
        fontSize: 13,
        whiteSpace: 'nowrap',
        zIndex: 20,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span aria-live="polite" data-testid="selection-count">
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection"
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 24,
          height: 24,
          padding: 0,
          border: '1px solid transparent',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--chrome-text)',
        }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4l.5 1H13v1.5H3V3h2.5L6 2Zm-1.5 4h7L11 14.5H5L4.5 6Z"
          />
        </svg>
      </button>
    </div>
  );
}
