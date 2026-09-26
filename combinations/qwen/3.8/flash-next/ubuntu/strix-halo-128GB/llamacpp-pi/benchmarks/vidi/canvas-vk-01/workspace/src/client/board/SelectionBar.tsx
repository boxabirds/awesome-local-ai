import { useMemo, type JSX } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import type { TextSize } from '../../shared/config';
import type { TextSnapshot } from '../../shared/objects/text';
import { TextToolbar } from '../objects/TextToolbar';

export interface SelectionBarProps {
  snapshot: readonly ObjectSnapshot[];
  ids: ReadonlySet<string>;
  camera: Camera;
  onDelete(): void;
  /**
   * A single selected text object (story 9) — the bar then shows the text
   * toolbar (size presets + delete) instead of the group count.
   */
  singleText?: TextSnapshot | null;
  onTextSize?(id: string, size: TextSize): void;
}

/**
 * The group action bar: appears when two or more objects are selected, shows a
 * polite live count and a Delete button; for exactly one selected text object
 * it shows the TextToolbar (story 9). A single selected sticky uses the
 * per-type `NoteToolbar` instead, so this renders nothing for size < 2.
 */
export function SelectionBar({
  snapshot,
  ids,
  camera,
  onDelete,
  singleText = null,
  onTextSize,
}: SelectionBarProps): JSX.Element | null {
  const selected = useMemo(
    () => snapshot.filter((obj) => ids.has(obj.id)),
    [snapshot, ids],
  );

  if (selected.length < 1) return null;

  const box = unionRects(selected.map(objectBounds));
  const anchor =
    box === null
      ? { x: 0, y: 0 }
      : worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });

  // Exactly one text object: the S/M/L/XL toolbar (story 9).
  if (selected.length === 1 && singleText !== null && singleText.id === selected[0]!.id) {
    return (
      <div
        className="selection-bar-screen"
        style={{
          position: 'fixed',
          left: `${anchor.x}px`,
          top: `${anchor.y - 44}px`,
          transform: 'translateX(-50%)',
          zIndex: 100,
          pointerEvents: 'auto',
        }}
      >
        <TextToolbar
          size={singleText.size}
          onSize={(size) => onTextSize?.(singleText.id, size)}
          onDelete={onDelete}
        />
      </div>
    );
  }

  if (selected.length < 2) return null;

  return (
    <div
      className="selection-bar-screen"
      data-testid="selection-bar"
      style={{
        position: 'fixed',
        left: `${anchor.x}px`,
        top: `${anchor.y - 44}px`,
        transform: 'translateX(-50%)',
        zIndex: 100,
        pointerEvents: 'auto',
      }}
    >
      <span
        aria-live="polite"
        aria-atomic="true"
        data-testid="selection-count"
        className="selection-bar-count"
      >
        {selected.length} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection"
        onClick={onDelete}
        className="selection-bar-delete"
      >
        Delete
      </button>
    </div>
  );
}
