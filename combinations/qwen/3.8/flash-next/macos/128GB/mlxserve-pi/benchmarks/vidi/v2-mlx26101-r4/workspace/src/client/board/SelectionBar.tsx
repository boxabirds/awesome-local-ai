/**
 * What is selected, and the one thing that can be done to all of it at once.
 *
 * The bar exists because a selection of several objects has no single object for a toolbar to belong
 * to: the story 2 toolbar — colours and a bin — is about *a* note, and there is no colour that means
 * "these six things". What there is, is a count. It is the answer to the question a person actually has
 * when four notes are outlined on a busy board: *which of these did I get?* — and the reason it is
 * rendered as text rather than as four outlines they have to count is that counting shapes on a board
 * is work the interface should not be asking for.
 *
 * It shows for two objects or more. With one sticky note selected the note's own toolbar is the right
 * control, and the two never appear at once — which is also why the delete button here and the bin on
 * the note's toolbar are different buttons with different reach: one deletes a note, the other deletes
 * a group.
 *
 * It is a *toolbar* to a screen reader, and the count is separately announced in a live region: the
 * bar itself is only useful to someone who can see the board, whereas the number is useful to anybody.
 */
import type { JSX } from 'react';

import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  /** The objects on the board, so a selection of ids that have gone away can be counted honestly. */
  snapshot: readonly ObjectSnapshot[];
  /** Where the person is looking, because the bar is placed against the selection, not the window. */
  camera: Camera;
  /** Delete everything selected. The button is the only control here. */
  onDelete(): void;
}

/** Between the top of the box and the bottom of the bar. */
const GAP_PX = 10;
/** How near the edge of the window the bar is still allowed to be. */
const EDGE_PX = 12;
/**
 * Half the width of the bar, and its height, in pixels. A guess, and deliberately so: the bar is a
 * number and a bin, which is a thing of known and small size. Measuring it would mean waiting for a
 * layout, and a bar that appears first in one place and then jumps to another is worse than a bar that
 * is a few pixels off every time.
 */
const HALF_WIDTH_PX = 96;
const HEIGHT_PX = 34;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, Math.max(low, high)));
}

/**
 * The bar, or nothing.
 *
 * The count is taken from the objects that are *both* selected and present: a selection that names an
 * object somebody else has just deleted is, for the person looking at it, a smaller selection, and a
 * bar that said "4 selected" over three outlined notes would be a bar that is wrong about the board.
 *
 * It sits above the box the selection makes, because the box is where the person is looking: a bar
 * pinned to the bottom of the window would be a control permanently far away from the thing it acts on,
 * and on a board that scrolls and zooms, "far away" is a place where nothing can be found.
 */
export function SelectionBar({ ids, snapshot, camera, onDelete }: SelectionBarProps): JSX.Element | null {
  if (ids.size === 0) return null;
  const selected = snapshot.filter((object) => ids.has(object.id));
  const count = selected.length;
  if (count < 2) return null;

  const bounds = unionRects(selected.map(objectBounds));
  const topLeft = bounds === null ? null : worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const style =
    topLeft === null || bounds === null
      ? undefined
      : {
          left: `${clamp(
            topLeft.x + (bounds.width * camera.zoom) / 2,
            HALF_WIDTH_PX + EDGE_PX,
            window.innerWidth - HALF_WIDTH_PX - EDGE_PX,
          )}px`,
          // A selection whose top is off the top of the window gets the bar kept in view rather than a
          // control that exists only off-screen.
          top: `${Math.max(EDGE_PX, topLeft.y - GAP_PX - HEIGHT_PX)}px`,
        };

  return (
    <>
      <div
        className="selection-bar"
        role="toolbar"
        aria-label="Selection"
        data-testid="selection-bar"
        style={style}
      >
        <span className="selection-bar__count" data-testid="selection-count">
          {count} selected
        </span>
        <button
          type="button"
          className="selection-bar__delete"
          aria-label="Delete selection"
          data-testid="selection-delete"
          onClick={onDelete}
        >
          <span className="note-toolbar__bin" />
        </button>
      </div>
      {/* Said out loud whenever the number changes, because the bar is only readable by someone who
          can see it, and a selection made by keyboard is invisible to nobody if it is spoken. */}
      <p className="selection-live" role="status" aria-live="polite" data-testid="selection-live">
        {count} selected
      </p>
    </>
  );
}
