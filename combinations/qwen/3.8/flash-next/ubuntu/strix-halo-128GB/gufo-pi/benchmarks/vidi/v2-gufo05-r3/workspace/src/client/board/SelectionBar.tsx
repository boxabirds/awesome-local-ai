import * as Y from 'yjs';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import { NoteToolbar } from '../objects/NoteToolbar';
import { ShapeToolbar } from '../objects/ShapeToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import {
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { setTextSize, setTextBox } from '../../shared/objects/text';
import { setShapeStyle, type ShapeSnap } from '../../shared/objects/shape';
import type { FillColor, StrokeColor } from '../../shared/config';
import { layoutText, createCanvasMeasurer } from '../objects/textLayout';
import type { StickyColor, TextSize } from '../../shared/config';
import type { TextSnapshot } from '../../shared/objects/text';

export interface SelectionBarProps {
  /** The selected ids. */
  ids: ReadonlySet<string>;
  /** The board, to read the selected objects' type and colour. */
  snapshot: readonly ObjectSnapshot[];
  /** Board document the colour swatches write to. */
  doc: Y.Doc;
  /** Delete the whole selection. */
  onDelete(): void;
  /**
   * This person's undo history (story 8): one colour click is one step, so a
   * colour never merges into the drag that happened just before it.
   */
  undo?: UndoController;
  /** Board cannot be changed: no controls at all (story 2 rule). */
  locked?: boolean;
  /**
   * Hide the controls but keep announcing: while a gesture is moving the
   * selection or its text is being typed, a control would only get in the way.
   */
  hideControls?: boolean;
}

/** Shared measurer instance. */
let measurer: ReturnType<typeof createCanvasMeasurer> | null = null;
function getMeasurer() {
  if (!measurer) measurer = createCanvasMeasurer();
  return measurer;
}

/**
 * The single control for the current selection, floating above it.
 *
 * One object: its own type's toolbar (a sticky note gets the colour swatches and
 * the bin, exactly as in story 2). Text gets S/M/L/XL + Delete. Several objects:
 * a count and one delete button.
 */
export function SelectionBar(props: SelectionBarProps) {
  const { ids, snapshot, doc, onDelete, undo, locked = false, hideControls = false } = props;
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
            undo?.boundary();
            setStickyColor(doc, note.id, color);
            undo?.boundary();
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

  if (single && single.type === 'shape') {
    const shape = single as ShapeSnap;
    // The shape's own toolbar, plus the bin: picking a colour is one command, so it
    // is one undo step, and it must not disturb the selection that put this bar here.
    return (
      <div className="selection-bar-slot">
        <ShapeToolbar
          fill={shape.fill}
          stroke={shape.stroke}
          onFill={(color: FillColor) => {
            undo?.boundary();
            setShapeStyle(doc, shape.id, { fill: color });
            undo?.boundary();
          }}
          onStroke={(color: StrokeColor) => {
            undo?.boundary();
            setShapeStyle(doc, shape.id, { stroke: color });
            undo?.boundary();
          }}
        />
        <div className="selection-bar" data-selection-bar="" role="toolbar" aria-label="Selection">
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
      </div>
    );
  }

  if (single && single.type === 'text') {
    const textSnap = single as TextSnapshot;
    return (
      <div className="selection-bar-slot">
        <TextToolbar
          size={textSnap.size}
          onSize={(s: TextSize) => {
            undo?.boundary();
            setTextSize(doc, textSnap.id, s);
            // Remeasure after size change (synchronous).
            const obj = doc.getMap<Y.Map<unknown>>('objects').get(textSnap.id);
            if (obj) {
              const ytext = obj.get('text');
              if (ytext && ytext instanceof Y.Text) {
                const mode = obj.get('widthMode') as 'auto' | 'fixed';
                const storedW = obj.get('width') as number;
                const result = layoutText(
                  ytext.toString(),
                  s,
                  mode,
                  mode === 'fixed' ? storedW : null,
                  getMeasurer(),
                );
                setTextBox(doc, textSnap.id, { width: result.width, height: result.height });
              }
            }
            undo?.boundary();
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
