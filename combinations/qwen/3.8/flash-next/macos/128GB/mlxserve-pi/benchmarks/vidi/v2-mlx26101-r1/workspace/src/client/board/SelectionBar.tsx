// The multi-selection action bar (story 7).
//
// Shown only for a selection of two or more objects: a floating bar just above the
// selection's bounding box reading "N selected" and offering one action, Delete,
// which removes the whole selection in a single operation. A *single* selected
// object does not use this bar — it shows its own object toolbar instead (the sticky
// note's colour swatches and bin, rendered inside the note) — so the two never
// overlap. The count is inside an aria-live region, so it is announced whenever the
// selection size changes.

import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Rect } from '../../shared/geometry';
import type { ReactElement } from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';

/** Gap (screen px) between the top of the selection and the bar. */
const BAR_GAP_PX = 12;

export interface SelectionBarProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  ids: ReadonlySet<string>;
  /** Delete every selected object at once (one undoable op on the board). */
  onDelete(): void;
}

/**
 * The floating bar over a multi-object selection. Returns null for fewer than two
 * selected objects (a single object shows its own toolbar; empty shows nothing).
 */
export function SelectionBar({
  camera,
  snapshot,
  ids,
  onDelete,
}: SelectionBarProps): ReactElement | null {
  if (ids.size < 2) return null;

  const rects: Rect[] = [];
  for (const obj of snapshot) {
    if (ids.has(obj.id)) rects.push(objectBounds(obj));
  }
  const box = unionRects(rects);
  if (!box) return null;

  const topCenter = worldToScreen(camera, {
    x: box.x + box.width / 2,
    y: box.y,
  });

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      style={{
        position: 'fixed',
        left: topCenter.x,
        top: topCenter.y - BAR_GAP_PX,
        transform: 'translate(-50%, -100%)',
        pointerEvents: 'auto',
        zIndex: 2147481000,
      }}
    >
      <span className="selection-count" aria-live="polite">
        {ids.size} selected
      </span>
      <button
        type="button"
        className="selection-delete"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
