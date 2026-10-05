import type * as Y from 'yjs';
import { getObjectType } from '../objects/registry';
import { NoteToolbar } from '../objects/NoteToolbar';
import {
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';

export interface SelectionBarProps {
  /** The selected ids. */
  ids: ReadonlySet<string>;
  /** The board, to read the selected objects' type and colour. */
  snapshot: readonly ObjectSnapshot[];
  /** Board document the colour swatches write to. */
  doc: Y.Doc;
  /** Delete the whole selection. */
  onDelete(): void;
  /** Board cannot be changed: no controls at all (story 2 rule). */
  locked?: boolean;
  /**
   * Hide the controls but keep announcing: while a gesture is moving the
   * selection or its text is being typed, a control would only get in the way.
   */
  hideControls?: boolean;
}

/**
 * The single control for the current selection, floating above it.
 *
 * One object: its own type's toolbar (a sticky note gets the colour swatches and
 * the bin, exactly as in story 2). Several objects: a count and one delete
 * button — one control for the group rather than a toolbar on every note.
 *
 * The spoken version of the count lives in `SelectionAnnouncement` below, which
 * the board owner keeps mounted: a live region that appears together with the
 * change is not announced.
 */
export function SelectionBar(props: SelectionBarProps) {
  const { ids, snapshot, doc, onDelete, locked = false, hideControls = false } = props;
  const count = ids.size;
  const selected = snapshot.filter((object) => ids.has(object.id));
  const single = count === 1 ? selected[0] : undefined;
  const spec = single ? getObjectType(single.type) : undefined;

  if (locked || hideControls || count === 0) {
    return <div className="selection-bar-slot" />;
  }

  if (single && spec?.editableText && single.type === 'sticky') {
    const note = single as StickySnapshot;
    return (
      <div className="selection-bar-slot">
        <NoteToolbar
          color={note.color}
          onColor={(color: StickyColor) => {
            // Only the colour changes: position, size, text and stacking stay.
            setStickyColor(doc, note.id, color);
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  return (
    <div className="selection-bar" data-selection-bar="" role="toolbar" aria-label="Selection">
      <span className="selection-count" data-selection-count="">
        {count} selected
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

export interface SelectionAnnouncementProps {
  /** How many objects are selected right now. */
  count: number;
}

/**
 * The count, spoken.
 *
 * A polite live region only announces a change inside a region that was already
 * there, so this one is mounted by the board owner for as long as the board is —
 * not inside the overlay, which disappears with the selection.
 */
export function SelectionAnnouncement(props: SelectionAnnouncementProps) {
  const { count } = props;
  const announcement =
    count === 0
      ? 'Selection cleared'
      : `${count} ${count === 1 ? 'object' : 'objects'} selected`;
  return (
    <p className="sr-only" aria-live="polite" data-selection-live="">
      {announcement}
    </p>
  );
}
