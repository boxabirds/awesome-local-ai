import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type StickySnapshot, getStickyText, hasObject } from '../../shared/board-model';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD } from '../../shared/config';
import type { ObjectProps } from './registry';
import { fitFontSize } from './StickyText';
import { StickyTextEditor } from './StickyTextEditor';

interface Fit {
  fontPx: number;
  overflow: boolean;
  /** Height of the text itself (without padding), world units. */
  textHeight: number;
}

/** A pre-wrap block shows no trailing empty line; a textarea does. Keep them the same height. */
function measurable(text: string): string {
  return text.endsWith('\n') || text === '' ? `${text}​` : text;
}

/**
 * A sticky note. Selecting, moving and resizing are generic (useTransformGesture via
 * `onPointerDown`); the note lays its content out at STICKY_SIZE_WORLD and scales it with its
 * width, so a bigger note shows bigger text.
 */
export function StickyNote(props: ObjectProps) {
  const { doc, zoom, selected, editing, editable } = props;
  const note = props.object as StickySnapshot;
  const noteRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Set between pointerdown and pointerup: focus from a press must not re-select.
  const pressingRef = useRef(false);
  const [fit, setFit] = useState<Fit>({
    fontPx: STICKY_FONT_MAX_PX,
    overflow: false,
    textHeight: 0,
  });
  const ytext = useMemo(
    () => (editing ? getStickyText(doc, note.id) : undefined),
    [doc, note.id, editing],
  );
  const contentScale = note.width / STICKY_SIZE_WORLD;
  const contentHeight = note.height / contentScale;

  // Font fit runs on text (or shape) change only: the font is in world units, so zoom scales it.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const { fontPx, overflow } = fitFontSize(el, contentHeight);
    const style = getComputedStyle(el);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
    const textHeight = Math.max(0, el.scrollHeight - padding);
    setFit((prev) =>
      prev.fontPx === fontPx && prev.overflow === overflow && prev.textHeight === textHeight
        ? prev
        : { fontPx, overflow, textHeight },
    );
  }, [note.text, contentHeight]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing) {
      // Clicks inside the editor belong to the text; never to the board.
      e.stopPropagation();
      return;
    }
    pressingRef.current = true;
    props.onPointerDown(e, note.id);
  };
  const endPress = () => {
    pressingRef.current = false;
  };

  const endEdit = (next: 'selected' | 'unselected') => {
    props.onEndEdit(next);
    if (next === 'selected') noteRef.current?.focus({ preventScroll: true });
  };

  const invZoom = 1 / zoom;
  const style = {
    left: note.x,
    top: note.y,
    width: note.width,
    height: note.height,
    zIndex: props.layer,
    backgroundColor: STICKY_COLORS[note.color],
    '--note-fade': STICKY_COLORS[note.color],
    '--inv-zoom': invZoom,
  } as CSSProperties;
  const bodyStyle: CSSProperties | undefined =
    contentScale === 1 && contentHeight === STICKY_SIZE_WORLD
      ? undefined
      : {
          right: 'auto',
          bottom: 'auto',
          width: STICKY_SIZE_WORLD,
          height: contentHeight,
          transform: `scale(${contentScale})`,
          transformOrigin: '0 0',
        };

  const classes = ['sticky-note'];
  if (fit.overflow) classes.push('is-overflowing');
  if (selected && props.transforming) classes.push('is-dragging');
  if (editing) classes.push('is-editing');

  return (
    <div
      ref={noteRef}
      className={classes.join(' ')}
      role="group"
      aria-label="Sticky note"
      tabIndex={0}
      data-sticky-id={note.id}
      data-object-id={note.id}
      data-selected={selected}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable && hasObject(doc, note.id)) props.onStartEdit(note.id);
      }}
      onFocus={(e) => {
        // Keyboard focus (Tab) selects; a pointer press selects through the gesture instead.
        if (e.target === e.currentTarget && !pressingRef.current && !selected)
          props.onSelect(note.id);
      }}
    >
      <div className="sticky-body" style={bodyStyle}>
        <div ref={measureRef} className="sticky-measure" aria-hidden="true">
          {measurable(note.text)}
        </div>
        {editing && ytext ? (
          <StickyTextEditor
            ytext={ytext}
            fontPx={fit.fontPx}
            onEnd={endEdit}
            style={fit.overflow ? { height: '100%' } : { height: fit.textHeight || undefined }}
          />
        ) : (
          <div className="sticky-text" style={{ fontSize: `${fit.fontPx}px` }}>
            {note.text}
          </div>
        )}
      </div>
    </div>
  );
}
