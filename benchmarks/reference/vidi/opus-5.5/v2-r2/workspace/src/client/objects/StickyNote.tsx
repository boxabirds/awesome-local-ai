import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type StickySnapshot, getStickyText } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import { STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD, fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';
import type { ObjectProps } from './types';

const PRIMARY_BUTTON = 0;
/** Height available to text inside a note at STICKY_SIZE_WORLD, in board units. */
const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD;

interface Fit {
  fontPx: number;
  overflow: boolean;
  /** Rendered text height in board units (capped at the text box). */
  textHeight: number;
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * One sticky note in the world layer: presses go to the generic transform
 * gesture (select, move, resize — sel.all_types); double-click edits.
 * The note's content is laid out at STICKY_SIZE_WORLD and scaled to the note's
 * width, so a bigger note shows bigger text (notes are always square).
 * Stacking uses `z-index: z` with the parent rendering objects in id order, so
 * equal z values tie-break by id and dragging never re-orders (and detaches) DOM nodes.
 */
export function StickyNote(props: ObjectProps): React.JSX.Element {
  const note = props.object as StickySnapshot;
  const { doc } = props;
  const id = note.id;
  const editable = props.editable;
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ fontPx: STICKY_FONT_MAX_PX, overflow: false, textHeight: 0 });
  const ytext = useMemo(() => getStickyText(doc, id), [doc, id]);
  const scale = note.width / STICKY_SIZE_WORLD;

  // Text fit: re-measured when the text changes (size and zoom scale everything uniformly).
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const result = fitFontSize(el, TEXT_BOX_WORLD);
    const textHeight = Math.min(el.scrollHeight, TEXT_BOX_WORLD);
    setFit((f) =>
      f.fontPx === result.fontPx && f.overflow === result.overflow && f.textHeight === textHeight
        ? f
        : { ...result, textHeight },
    );
  }, [note.text]);

  // Keyboard users: focus the note again when editing ends with Escape.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  const classes = ['sticky-note'];
  if (props.selected) classes.push('is-selected');
  if (props.transforming) classes.push('is-dragging');
  if (fit.overflow) classes.push('sticky-note--overflow');
  const lineHeightWorld = fit.fontPx * STICKY_LINE_HEIGHT;
  const editorTop = STICKY_PADDING_WORLD + (TEXT_BOX_WORLD - Math.max(fit.textHeight, lineHeightWorld)) / 2;

  return (
    <div
      ref={rootRef}
      className={classes.join(' ')}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-sticky-note=""
      data-id={id}
      data-color={note.color}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={props.editing ? 'true' : 'false'}
      data-state={props.transforming ? 'dragging' : 'idle'}
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
        zIndex: note.z,
        backgroundColor: STICKY_COLORS[note.color],
        ['--sticky-color' as string]: STICKY_COLORS[note.color],
        ['--sticky-scale' as string]: scale,
      }}
      onPointerDown={(e) => {
        // The board must never pan (or clear the selection) from a press on a note.
        e.stopPropagation();
        if (props.editing || e.button !== PRIMARY_BUTTON) return;
        props.onPointerDown(e, id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable && !props.editing) props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (editable && e.key === 'Enter' && e.target === e.currentTarget && !props.editing) {
          e.preventDefault();
          props.onStartEdit(id);
        }
      }}
      onFocus={(e) => {
        // Tab reaches a note and selects it; mouse focus selects through the gesture instead.
        if (e.target === e.currentTarget && !props.selected && isFocusVisible(e.currentTarget)) props.onSelect(id);
      }}
    >
      <div
        className="sticky-content"
        style={{
          width: STICKY_SIZE_WORLD,
          height: STICKY_SIZE_WORLD,
          transform: scale === 1 ? undefined : `scale(${scale})`,
        }}
      >
        <div
          ref={contentRef}
          className="sticky-text"
          data-testid="sticky-text"
          style={{
            fontSize: `${fit.fontPx}px`,
            lineHeight: STICKY_LINE_HEIGHT,
            left: STICKY_PADDING_WORLD,
            right: STICKY_PADDING_WORLD,
            maxHeight: TEXT_BOX_WORLD,
            visibility: props.editing ? 'hidden' : undefined,
          }}
        >
          {note.text}
        </div>
        {props.editing && ytext && (
          <div className="sticky-editor-wrap" style={{ top: editorTop, bottom: STICKY_PADDING_WORLD }}>
            <StickyTextEditor ytext={ytext} fontPx={fit.fontPx} onEnd={props.onEndEdit} />
          </div>
        )}
      </div>
    </div>
  );
}
