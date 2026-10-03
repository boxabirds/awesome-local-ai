// The multi-selection action bar (story 7) and the single-text size toolbar
// (story 9).
//
// For two or more objects it is a floating bar just above the selection's bounding
// box reading "N selected" and offering one action, Delete, which removes the whole
// selection in a single operation. For exactly one selected *text* object it shows
// the shared TextToolbar (S / M / L / XL + Delete) in the same place, which is why
// this bar — not the object — owns that control: a board full of text objects then
// still has one toolbar on screen, and the design's rule that a text object reuses
// the generic selection affordances keeps a text-specific control out of the object.
// Any *other* single object shows its own toolbar instead (the sticky note's colour
// swatches and bin, rendered inside the note), so the two never overlap. The count is
// inside an aria-live region, so it is announced whenever the selection size changes.

import { objectBounds, type ObjectSnapshot, type TextSnapshot } from '../../shared/board-model';
import { unionRects, type Rect } from '../../shared/geometry';
import type { TextSize } from '../../shared/config';
import type { ReactElement } from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { TextToolbar } from '../objects/TextToolbar';

/** Gap (screen px) between the top of the selection and the bar. */
const BAR_GAP_PX = 12;

export interface SelectionBarProps {
  camera: Camera;
  snapshot: readonly ObjectSnapshot[];
  ids: ReadonlySet<string>;
  /** Delete every selected object at once (one undoable op on the board). */
  onDelete(): void;
  /** The one selected text object changed size preset (story 9). */
  onTextSize?(id: string, size: TextSize): void;
}

/**
 * The floating bar over a selection: "N selected" + Delete for two or more, the text
 * size toolbar for exactly one text object, nothing otherwise.
 */
export function SelectionBar({
  camera,
  snapshot,
  ids,
  onDelete,
  onTextSize,
}: SelectionBarProps): ReactElement | null {
  if (ids.size === 0) return null;

  const rects: Rect[] = [];
  let sole: TextSnapshot | null = null;
  for (const obj of snapshot) {
    if (!ids.has(obj.id)) continue;
    rects.push(objectBounds(obj));
    if (ids.size === 1 && obj.type === 'text') sole = obj as TextSnapshot;
  }
  const box = unionRects(rects);
  if (!box) return null;

  const topCenter = worldToScreen(camera, {
    x: box.x + box.width / 2,
    y: box.y,
  });

  const style: React.CSSProperties = {
    position: 'fixed',
    left: topCenter.x,
    top: topCenter.y - BAR_GAP_PX,
    transform: 'translate(-50%, -100%)',
    pointerEvents: 'auto',
    zIndex: 2147481000,
  };

  // Exactly one text object: its size presets and Delete, above its own box.
  if (sole && onTextSize) {
    return (
      <div style={style}>
        <TextToolbar
          size={sole.size}
          onSize={(size) => onTextSize(sole!.id, size)}
          onDelete={onDelete}
        />
      </div>
    );
  }

  if (ids.size < 2) return null;

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      style={style}
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
