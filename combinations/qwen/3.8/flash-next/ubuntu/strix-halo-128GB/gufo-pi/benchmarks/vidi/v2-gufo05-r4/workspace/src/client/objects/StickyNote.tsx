/**
 * One sticky note on the board.
 *
 * It renders the note from the document snapshot and asks the generic layer for its
 * behaviour:
 *
 *   Unselected --pointerdown--> Pressed --move >= DRAG_THRESHOLD_PX--> Dragging
 *   Pressed --pointerup--> Selected        Dragging --pointerup/cancel--> Selected
 *   Selected --dblclick / Enter--> Editing --Escape--> Selected
 *
 * Story 7 moved the drag out of this file. Pressing a note hands the event to
 * `useTransformGesture`, which selects it (or not, with Shift), moves the whole selection
 * with it and raises it above the objects it overlaps — the same code every other kind of
 * object will use, which is the point of `sel.all_types`. What stays here is what belongs
 * to a sticky note: its colour, its text, fitting a font into the box it has been given,
 * and the toolbar that changes its colour or deletes it.
 *
 * Everything that changes the note still goes through `src/shared/board-model.ts`; the note
 * never stores state in the DOM, so a re-render from a document change — the user's own, or
 * somebody else's — always shows the truth.
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type * as Y from 'yjs';
import {
  deleteObject,
  getStickyText,
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot
} from '../../shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  NOTE_TOOLBAR_GAP_WORLD,
  STICKY_COLORS,
  STICKY_FADE_HEIGHT_PX,
  STICKY_FONT_MAX_PX,
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_WORLD,
  type StickyColor
} from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import type { EndEditNext } from '../board/useSelection';
import type { ObjectGestureHandlers } from './registry';
import { NoteToolbar } from './NoteToolbar';
import { StickyTextEditor } from './StickyTextEditor';
import { fitFontSize } from './StickyText';

export interface StickyNoteProps {
  /** The note as the document holds it. */
  object: ObjectSnapshot;
  /** Where it is and how big it is, in board units (story 7: it is no longer a fixed square). */
  bounds: Rect;
  doc: Y.Doc;
  /** Camera zoom, used to keep the toolbar screen-sized. */
  zoom: number;
  selected: boolean;
  /** How many objects the selection holds: the toolbar belongs to a note that is all of it. */
  selectedCount: number;
  editing: boolean;
  /**
   * False while the board cannot be written to (story 4: the room could not load it).
   * The note still shows what it holds, and still selects, but nothing about it is
   * changed — a drag, an edit, a colour or a delete would be written into a document
   * that is about to be thrown away.
   */
  canEdit?: boolean;
  /** A move or resize of this note is running: its toolbar stands aside. */
  transforming?: boolean;
  gesture: ObjectGestureHandlers;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

/** Text size and overflow for a note's content box. */
interface Fit {
  fontPx: number;
  overflow: boolean;
}

export function StickyNote(props: StickyNoteProps): JSX.Element {
  const { object, bounds, doc, zoom, selected, editing: editingProp, gesture, onStartEdit, onEndEdit } = props;
  const canEdit = props.canEdit !== false;
  // A board that has just become unwritable must not keep an open text box either.
  const editing = editingProp && canEdit;
  // A sticky note's own fields. A document written by an older build is complete enough
  // to render: colour falls back to the default one.
  const color = isStickyColorValue(object) ? object.color : DEFAULT_STICKY_COLOR;
  const text = 'text' in object && typeof object.text === 'string' ? object.text : '';
  const selectedCount = props.selectedCount ?? (selected ? 1 : 0);

  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

  const latest = useRef({ doc, canEdit, onEndEdit });
  latest.current = { doc, canEdit, onEndEdit };

  // The text box is the note's width less its padding, so resizing a note re-fits its
  // text: a wider note fits a larger font, and a headline can be made bigger than the
  // ideas under it.
  const contentBox = Math.max(bounds.width - STICKY_PADDING_WORLD * 2, 0);

  // Auto-fit: the largest font in the configured range in which all the text fits,
  // and whether it no longer fits even at the smallest size. Measuring needs real
  // layout, so jsdom always reports the largest size; the browser checks the rest.
  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element) return;
    const next = fitFontSize(element, contentBox);
    setFit((previous) =>
      previous.fontPx === next.fontPx && previous.overflow === next.overflow ? previous : next
    );
  }, [text, contentBox]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Editing owns the pointer: a click inside the text box places the caret.
      if (editing) {
        event.stopPropagation();
        return;
      }
      gesture.onObjectPointerDown(event, object.id);
    },
    [editing, gesture, object.id]
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // A double-click on a note edits that note instead of creating a new one.
      event.stopPropagation();
      if (editing || !canEdit) return;
      onStartEdit(object.id);
    },
    [canEdit, editing, object.id, onStartEdit]
  );

  // A note that disappears mid-interaction is not rendered any more (the parent builds
  // this component from the document snapshot), so the gesture simply stops being told.

  const handleColor = useCallback((next: StickyColor) => {
    if (!latest.current.canEdit) return;
    // Only the colour changes: text, position and the selection are untouched.
    setStickyColor(latest.current.doc, object.id, next);
  }, [object.id]);

  const handleDelete = useCallback(() => {
    if (!latest.current.canEdit) return;
    deleteObject(latest.current.doc, object.id);
    // The note is gone, so the selection goes with it.
    latest.current.onEndEdit('unselected');
  }, [object.id]);

  const stopPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const noteStyle = {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    background: STICKY_COLORS[color],
    padding: STICKY_PADDING_WORLD,
    // The overflow fade blends into this note's own colour.
    '--sticky-fade': STICKY_COLORS[color],
    '--sticky-fade-height': `${STICKY_FADE_HEIGHT_PX}px`
  } as CSSProperties;

  const textStyle: CSSProperties = {
    fontSize: `${fit.fontPx}px`,
    lineHeight: STICKY_LINE_HEIGHT,
    alignItems: fit.overflow ? 'flex-start' : 'center'
  };

  const measureStyle: CSSProperties = {
    width: contentBox,
    lineHeight: STICKY_LINE_HEIGHT
  };

  const toolbarStyle: CSSProperties = {
    bottom: `calc(100% + ${NOTE_TOOLBAR_GAP_WORLD}px)`,
    transform: `scale(${1 / (zoom || 1)})`
  };

  const ytext = editing ? getStickyText(doc, object.id) : undefined;
  const interaction = props.transforming === true ? 'dragging' : editing ? 'editing' : 'idle';

  return (
    <div
      ref={rootRef}
      className="vidi6-sticky"
      data-vidi6="sticky"
      data-object-id={object.id}
      data-object-type={object.type}
      data-note-id={object.id}
      data-color={color}
      data-x={bounds.x}
      data-y={bounds.y}
      data-width={bounds.width}
      data-height={bounds.height}
      data-selected={selected ? 'true' : 'false'}
      data-overflow={fit.overflow ? 'true' : 'false'}
      data-interaction={interaction}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      style={noteStyle}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Off-screen measuring layer: same width and wrapping as the visible text. */}
      <div ref={measureRef} className="vidi6-sticky-measure" aria-hidden="true" style={measureStyle}>
        {text}
      </div>

      {editing && ytext ? (
        <div className="vidi6-sticky-edit" data-testid="sticky-edit" style={textStyle} onPointerDown={stopPointer}>
          <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={onEndEdit} />
        </div>
      ) : (
        <div className="vidi6-sticky-text" data-testid="sticky-text" style={textStyle}>
          {text}
        </div>
      )}

      {/* Text that no longer fits is clipped inside the note and fades here. */}
      {fit.overflow ? <div className="vidi6-sticky-fade" data-testid="sticky-fade" aria-hidden="true" /> : null}

      {selected && selectedCount === 1 && !editing && interaction === 'idle' ? (
        <div className="vidi6-note-toolbar-anchor" style={toolbarStyle}>
          <NoteToolbar color={color} onColor={handleColor} onDelete={handleDelete} disabled={!canEdit} />
        </div>
      ) : null}
    </div>
  );
}

/** Does this object carry a sticky note's colour? */
function isStickyColorValue(object: ObjectSnapshot): object is StickySnapshot {
  return typeof (object as StickySnapshot).color === 'string';
}
