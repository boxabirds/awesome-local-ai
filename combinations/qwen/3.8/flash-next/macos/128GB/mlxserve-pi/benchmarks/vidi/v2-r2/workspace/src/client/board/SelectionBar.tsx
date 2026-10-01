// The selection bar (story 7): the small floating toolbar a selection gets,
// offering what only makes sense for many objects at once - bring them all to
// the front, delete them all.
//
// It is deliberately type-blind: it counts ids and calls the group operations
// of board-model. It never asks what kind of objects they are, and a future
// story's shapes get its buttons for free. Per-object actions (colours, the
// bin) stay on the object's own toolbar and only ever appear for a single
// selected object - two toolbars at once would fight over the same corner of
// the screen.

import { type JSX } from 'react';
import { useBoardCamera } from '../canvas/CameraProvider';
import { screenBox } from './SelectionOverlay';
import type { Rect } from '../../shared/geometry';

export interface SelectionBarProps {
  /** How many objects are selected. */
  count: number;
  /** The selection's bounding box, so the bar can float under it. */
  rect: Rect;
  onBringToFront(): void;
  onDelete(): void;
}

export function SelectionBar({ count, rect, onBringToFront, onDelete }: SelectionBarProps): JSX.Element {
  const { camera } = useBoardCamera();
  const box = screenBox(camera, rect);
  const centreX = box.x + box.width / 2;
  const bottom = box.y + box.height;

  return (
    <div
      data-testid="selection-bar"
      className="selection-bar"
      style={{ left: centreX, top: bottom + 12, transform: 'translateX(-50%)' }}
    >
      {/* role=status: the count is announced when it changes, and a keyboard
          or screen-reader user never has to chase the bar to learn what it
          is acting on */}
      <span data-testid="selection-count" className="selection-count" role="status" aria-live="polite">
        {count} selected
      </span>
      <button
        type="button"
        data-testid="selection-bring-to-front"
        className="selection-bar-button"
        onClick={onBringToFront}
      >
        Bring to front
      </button>
      <button
        type="button"
        data-testid="selection-delete"
        className="selection-bar-button selection-bar-button--danger"
        onClick={onDelete}
      >
        Delete selection
      </button>
    </div>
  );
}
