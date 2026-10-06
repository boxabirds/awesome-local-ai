import { objectBounds, type ObjectSnapshot } from "../../shared/board-model";
import { unionRects } from "../../shared/geometry";
import type { TextSize } from "../../shared/config";
import type { TextSnapshot } from "../../shared/objects/text";
import { TextToolbar } from "../objects/TextToolbar";
import type { Camera } from "../canvas/camera";
import { worldToScreen } from "../canvas/camera";

/**
 * The bar above a multi-object selection (`sel.interaction`): "N selected" and
 * one Delete button that removes the whole selection.
 *
 * It is drawn in screen space, so its size does not change with the board zoom,
 * and the count is in an `aria-live` region: a screen reader hears the selection
 * change. When exactly one sticky note is selected, story 2's note toolbar is
 * shown instead — by the note itself — so this bar renders nothing. Story 9 adds
 * the other case: exactly one text object gets the text toolbar here, because a
 * text object has no furniture of its own.
 */

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** The bar sits above the selection's bounding box, which needs the camera. */
  camera: Camera;
  onDelete(): void;
  /** Story 9: changing a text object's font size (one undo step in `App`). */
  onTextSize?(id: string, size: TextSize): void;
  /** The object being typed into gets no toolbar: its field is its toolbar. */
  editingId?: string | null;
}

/** Gap between the bounding box and the bar, in screen pixels. */
const BAR_GAP_PX = 8;
/** Height the bar occupies, used to keep it inside the viewport. */
const BAR_HEIGHT_PX = 32;

export function SelectionBar({ ids, snapshot, camera, onDelete, onTextSize, editingId }: SelectionBarProps) {
  if (ids.size === 0) return null;

  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  // Exactly one text object: its own toolbar, in the same place this bar draws.
  const only = selected.length === 1 ? selected[0] : undefined;
  const isEditing = only !== undefined && editingId !== undefined && editingId === only.id;
  const textToolbar =
    only !== undefined && only.type === "text" && !isEditing && onTextSize !== undefined
      ? (only as TextSnapshot)
      : undefined;
  if (only !== undefined && selected.length === 1 && textToolbar === undefined) return null;

  const box = unionRects(selected.map((object) => objectBounds(object)));
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
      {textToolbar ? (
        <TextToolbar
          size={textToolbar.size}
          onSize={(size: TextSize) => onTextSize?.(textToolbar.id, size)}
          onDelete={onDelete}
        />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

function px(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
