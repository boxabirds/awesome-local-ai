/**
 * The bar that floats above a selection of two or more objects: "N selected" and a
 * delete (bin) button (`sel.bar`, `sel.group_delete`).
 *
 * With exactly one sticky note selected there is nothing to say — the note's own toolbar
 * (colours and delete) is already above it — so this renders no bar in that case, and the
 * note keeps the space.
 *
 * The count is also written into a polite live region, which is how "6 selected" reaches a
 * screen reader when the selection changes (`sel.bar`, accessibility): the number is the
 * only place a person who cannot see the board learns how big their selection is.
 */

import { useCallback, type JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { boxToScreen } from './SelectionOverlay';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** Where to put the bar: centred above the selection's bounding box. */
  camera?: Camera;
  onDelete(): void;
  /** False while the board cannot be written to: the bar is shown, the button does nothing. */
  disabled?: boolean;
}

/** Delete (bin) glyph, drawn rather than a font emoji so it looks the same everywhere. */
function BinIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
      />
    </svg>
  );
}

export function SelectionBar(props: SelectionBarProps): JSX.Element {
  const { ids, snapshot, camera } = props;
  const count = ids.size;

  const deleteSelection = useCallback(
    (event: { preventDefault(): void }) => {
      event.preventDefault();
      if (props.disabled === true) return;
      props.onDelete();
    },
    [props]
  );

  const stopPointer = (event: { stopPropagation(): void }) => {
    // A press on the bar is not a press on the board: it must not clear the selection
    // it belongs to, and must never start a pan.
    event.stopPropagation();
  };

  // Announced whatever else is rendered, including "nothing selected".
  const announcement = count > 0 ? `${count} selected` : '';

  if (count < 2) {
    return (
      <span className="vidi6-sr-only" aria-live="polite" data-testid="selection-live">
        {announcement}
      </span>
    );
  }

  const box = unionRects(snapshot.filter((object) => ids.has(object.id)).map((object) => objectBounds(object)));
  const position = box && camera ? boxToScreen(box, camera) : null;
  const style = position ? { left: position.left + position.width / 2, top: position.top } : undefined;

  return (
    <>
      <span className="vidi6-sr-only" aria-live="polite" data-testid="selection-live">
        {announcement}
      </span>
      <div
        className="vidi6-selection-bar"
        data-vidi6="selection-bar"
        data-testid="selection-bar"
        role="toolbar"
        aria-label="Selection"
        style={style}
        onPointerDown={stopPointer}
        onDoubleClick={stopPointer}
      >
        <span className="vidi6-selection-count" data-testid="selection-count">
          {`${count} selected`}
        </span>
        <button
          type="button"
          className="vidi6-selection-delete"
          data-vidi6="selection-delete"
          aria-label="Delete selection"
          title="Delete selection"
          disabled={props.disabled === true}
          onClick={deleteSelection}
        >
          <BinIcon />
        </button>
      </div>
    </>
  );
}
