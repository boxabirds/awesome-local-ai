import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { StickySnapshot } from '../../shared/board-model';
import { hitTestBounds, type ObjectTypeSpec } from './registry';
import { StickyNote } from './StickyNote';

/**
 * The sticky note, described for the generic selection machinery.
 *
 * A note is resizable and keeps its square proportions, and it may shrink to
 * STICKY_MIN_SIZE_WORLD before the text would stop being readable. That is the
 * whole of what story 7 needs to know about it: it has no selection, marquee,
 * move or resize code of its own, and neither will the shapes, text and pen of
 * stories 9-12 (`sel.all_types`).
 */
export const stickyObjectType: ObjectTypeSpec = {
  aspectLocked: true,
  resizable: true,
  editableText: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  hitTest: hitTestBounds,
  Component: function StickyNoteType(props) {
    const { snapshot, selection, onEditChange, onObjectPointerDown, doc } = props;
    return (
      <StickyNote
        note={snapshot as StickySnapshot}
        doc={doc}
        selected={selection.selected}
        editing={selection.editing}
        dragging={selection.dragging}
        onEditChange={(next) => onEditChange(snapshot.id, next)}
        onObjectPointerDown={(event, pressed) =>
          onObjectPointerDown(event, pressed as StickySnapshot)
        }
      />
    );
  },
};
