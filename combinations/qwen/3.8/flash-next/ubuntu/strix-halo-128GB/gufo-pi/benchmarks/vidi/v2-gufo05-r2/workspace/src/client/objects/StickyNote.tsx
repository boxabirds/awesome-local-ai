import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_PADDING_WORLD } from '../../shared/config';
import { getStickyText, isStickySnapshot, objectBounds } from '../../shared/board-model';
import { fitFontSize } from './StickyText';
import { stickyContentBox, StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './registry';

/**
 * One sticky note in the world layer.
 *
 * Two things are true of every object here: its position, size and stacking are
 * shared document state that this component is a pure function of, and its text
 * is a live `Y.Text` edited directly, so two people typing in one note get the
 * CRDT behaviour story 6 relies on. All mutations go through the board model.
 *
 * Story 7 took the pointer work out. A press is handed to `useTransformGesture`,
 * which decides between a click, a drag of the whole selection and nothing at
 * all, so a note behaves exactly like every other object type. What is left here
 * is drawing, and text.
 */
export function StickyNote(props: ObjectProps) {
  const {
    object,
    doc,
    zoom,
    selected,
    editing,
    editable,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
  } = props;
  // The registry gives every type the common shape; a note also carries its colour
  // and its text, which is what this component draws.
  const note = isStickySnapshot(object) ? object : null;
  const text = note?.text ?? '';
  const color = note?.color ?? 'yellow';
  const textRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const box = objectBounds(object);

  // Auto-fit the display text (largest size 24..10px at which it fits). A resized
  // note is measured on its own box, so a smaller note holds less text.
  useLayoutEffect(() => {
    if (editing) return;
    const el = textRef.current;
    if (!el) return;
    const result = fitFontSize(el, stickyContentBox(el));
    setOverflow(result.overflow);
  }, [text, object.width, object.height, editing, zoom]);

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this note, never creating a new one (sticky.edit_start).
    event.stopPropagation();
    if (!editable) return;
    onStartEdit(object.id);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // While editing, the text owns the pointer: a press inside it places the
    // caret rather than dragging the note.
    if (editingRef.current) {
      event.stopPropagation();
      return;
    }
    onObjectPointerDown(event, object.id);
  };

  const ytext = editing ? getStickyText(doc, object.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Sticky note"
      data-note-id={object.id}
      data-object-id={object.id}
      data-object-type="sticky"
      data-selected={selected ? 'true' : 'false'}
      className="sticky-note"
      tabIndex={0}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        backgroundColor: STICKY_COLORS[color],
        zIndex: object.z,
        ['--sticky-padding' as string]: `${STICKY_PADDING_WORLD}px`,
      } as CSSProperties}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onDragStart={(event) => event.preventDefault()}
    >
      {editing && ytext ? (
        <StickyTextEditor
          ytext={ytext}
          fontPx={STICKY_FONT_MAX_PX}
          readOnly={!editable}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          ref={textRef}
          className={`sticky-note__text${overflow ? ' has-overflow' : ''}`}
          data-testid={`sticky-text-${object.id}`}
        >
          <div className="sticky-note__label">{text}</div>
        </div>
      )}
    </div>
  );
}
