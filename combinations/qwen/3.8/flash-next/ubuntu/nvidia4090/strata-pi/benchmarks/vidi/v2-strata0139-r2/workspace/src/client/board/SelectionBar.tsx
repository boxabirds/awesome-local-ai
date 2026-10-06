import { objectBounds, type ObjectSnapshot } from "../../shared/board-model";
import { unionRects } from "../../shared/geometry";
import type { Camera } from "../canvas/camera";
import { worldToScreen } from "../canvas/camera";

/**
 * The bar above a multi-object selection (`sel.interaction`): "N selected" and
 * one Delete button that removes the whole selection.
 *
 * It is drawn in screen space, so its size does not change with the board zoom,
 * and the count is in an `aria-live` region: a screen reader hears the selection
 * change. When exactly one sticky note is selected, story 2's note toolbar is
 * shown instead — by the note itself — so this bar renders nothing.
 */

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** The bar sits above the selection's bounding box, which needs the camera. */
  camera: Camera;
  onDelete(): void;
}

/** Gap between the bounding box and the bar, in screen pixels. */
const BAR_GAP_PX = 8;
/** Height the bar occupies, used to keep it inside the viewport. */
const BAR_HEIGHT_PX = 32;

export function SelectionBar({ ids, snapshot, camera, onDelete }: SelectionBarProps) {
  if (ids.size < 2) return null;

  const box = unionRects(
    snapshot.filter((object) => ids.has(object.id)).map((object) => objectBounds(object)),
  );
  if (!box) return null;

  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  const width = box.width * zoom;
  const left = Math.max(8, topLeft.x);
  const top = Math.max(8, topLeft.y - BAR_GAP_PX - BAR_HEIGHT_PX);

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      data-selection-size={ids.size}
      role="group"
      aria-label="Selection tools"
      style={{ left: `${px(left)}px`, top: `${px(top)}px`, minWidth: `${px(Math.min(width, 240))}px` }}
      onPointerDown={(event) => {
        // A control, never a board gesture: no pan, no marquee, no clear.
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="selection-count" data-testid="selection-count" aria-live="polite">
        {ids.size} selected
      </span>
      <button
        type="button"
        className="selection-delete"
        data-testid="selection-delete"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
      >
        &#128465;
      </button>
    </div>
  );
}

function px(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
