// The selection bar (sel.visuals, PRD "a small bar showing how many objects are
// selected and offering delete"). It appears for a MULTI-selection: exactly one
// sticky note keeps story 2's NoteToolbar instead (TC-18).
//
// It is a child of the board container, NOT of the zoomed world layer, so its text
// and button stay the same size at every zoom level; only its position follows the
// selection (screen coordinates from the camera).

import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Rect } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';

export interface SelectionBarProps {
  /** The selected objects (fewer than two → render nothing). */
  objects: readonly ObjectSnapshot[];
  camera: Camera;
  editable: boolean;
  onDelete(): void;
}

/** Screen pixels between the bar and the top of the selection. */
const BAR_GAP_PX = 12;

export const SelectionBar = ({ objects, camera, editable, onDelete }: SelectionBarProps) => {
  if (!editable || objects.length < 2) return null;

  const bbox: Rect | null = unionRects(objects.map(objectBounds));
  if (!bbox) return null;
  const top = worldToScreen(camera, { x: bbox.x + bbox.width / 2, y: bbox.y });

  return (
    <div
      data-testid="selection-bar"
      style={{
        // A sibling of the viewport: fixed positioning puts it in viewport
        // coordinates, which is exactly what worldToScreen returns.
        position: 'fixed',
        left: `${top.x}px`,
        top: `max(8px, ${top.y - BAR_GAP_PX}px)`,
        transform: 'translate(-50%, -100%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: 'rgba(17, 17, 17, 0.88)',
        color: '#fff',
        borderRadius: HANDLE_SIZE_PX / 2,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        lineHeight: '16px',
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
    >
      <span data-testid="selection-count">{`${objects.length} selected`}</span>
      <button
        type="button"
        data-testid="selection-delete"
        aria-label="Delete selection"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{
          appearance: 'none',
          border: 'none',
          borderRadius: 4,
          padding: '2px 8px',
          background: '#dc2626',
          color: '#fff',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        Delete
      </button>
    </div>
  );
};

/** The screen-reader announcement of the selection size (sel.visuals: "N objects
 * selected" through an aria-live region). Rendered by the App at all times, so a
 * change is announced even when it goes to zero. */
export const SelectionStatus = ({ count }: { count: number }) => (
  <div
    data-testid="selection-status"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    style={{
      position: 'absolute',
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      whiteSpace: 'nowrap',
      border: 0,
    }}
  >
    {count === 0 ? 'Nothing selected' : `${count} selected`}
  </div>
);
